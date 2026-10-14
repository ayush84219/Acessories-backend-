import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  generateRgpPDF,
  generateQRCode,
  toDataURL,
  WEB_APP_URL
} from "./FabricRgpform";

const HARDCODED_API_KEY = "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk";
const DEFAULT_SPREADSHEET_ID = "1BZ-ufmxeqa9XdU-jkuIgeNxHvhnYKjWj4UpnI3bHJKo";

function normalizeRgpNo(val) {
  return String(val || "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "");
}

function parseRgpSeq(val) {
  const norm = normalizeRgpNo(val);
  const nums = norm.match(/\d+/g) || [];
  if (nums.length > 0) {
    return parseInt(nums[nums.length - 1], 10);
  }
  return null;
}

export default function RedownloadRgp({
  spreadsheetId = DEFAULT_SPREADSHEET_ID,
  apiKey = HARDCODED_API_KEY,
  onBack
}) {
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  const [rgpMainData, setRgpMainData] = useState([]);
  const [rgpItemsData, setRgpItemsData] = useState([]);

  const [selectedRgpNo, setSelectedRgpNo] = useState("");
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // Fetch all Fabric_RGP & Fabric_RGP_Items on load
  const fetchAllData = async () => {
    setLoading(true);
    setError("");
    try {
      const mainUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
        "Fabric_RGP!A1:Z"
      )}?key=${apiKey}`;
      const itemsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
        "Fabric_RGP_Items!A1:Z"
      )}?key=${apiKey}`;

      const [mainRes, itemsRes] = await Promise.all([
        fetch(mainUrl),
        fetch(itemsUrl)
      ]);

      if (!mainRes.ok) {
        const text = await mainRes.text();
        throw new Error(`Failed to fetch Fabric_RGP sheet (${mainRes.status}): ${text.slice(0, 150)}`);
      }

      const mainJson = await mainRes.json();
      const mainRows = mainJson.values || [];
      if (mainRows.length === 0) {
        throw new Error("Fabric_RGP sheet is empty");
      }

      const mainHeaders = mainRows[0].map((h) => String(h || "").trim());
      const parsedMain = mainRows.slice(1).map((row) => {
        const obj = {};
        mainHeaders.forEach((hdr, idx) => {
          obj[hdr] = row[idx] !== undefined ? String(row[idx]).trim() : "";
        });
        return obj;
      }).filter(r => r["RGP No"] || r["RGP No."]);

      let parsedItems = [];
      if (itemsRes.ok) {
        const itemsJson = await itemsRes.json();
        const itemsRows = itemsJson.values || [];
        if (itemsRows.length > 0) {
          const itemsHeaders = itemsRows[0].map((h) => String(h || "").trim());
          parsedItems = itemsRows.slice(1).map((row) => {
            const obj = {};
            itemsHeaders.forEach((hdr, idx) => {
              obj[hdr] = row[idx] !== undefined ? String(row[idx]).trim() : "";
            });
            return obj;
          }).filter(r => r["RGP No"] || r["RGP No."]);
        }
      }

      setRgpMainData(parsedMain);
      setRgpItemsData(parsedItems);

      if (parsedMain.length > 0) {
        setSelectedRgpNo(parsedMain[parsedMain.length - 1]["RGP No"] || parsedMain[parsedMain.length - 1]["RGP No."]);
      }
    } catch (err) {
      console.error("Error fetching RGP sheets:", err);
      setError(err.message || "Failed to load RGP data from Google Sheets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, [spreadsheetId, apiKey]);

  // Filtered RGP Main records for search dropdown / list
  const filteredMainRecords = useMemo(() => {
    const q = normalizeRgpNo(searchQuery);
    if (!q) return rgpMainData;

    const querySeq = parseRgpSeq(q);

    return rgpMainData.filter((row) => {
      const rgpNo = normalizeRgpNo(row["RGP No"] || row["RGP No."]);
      const vendor = String(row["Vendor / Party"] || row["Vendor"] || "").toUpperCase();
      const dept = String(row["Department"] || "").toUpperCase();
      const rgpType = String(row["RGP Type"] || "").toUpperCase();

      if (rgpNo.includes(q) || vendor.includes(q) || dept.includes(q) || rgpType.includes(q)) {
        return true;
      }

      if (querySeq !== null) {
        const rgpSeq = parseRgpSeq(rgpNo);
        if (rgpSeq === querySeq) return true;
      }

      return false;
    });
  }, [rgpMainData, searchQuery]);

  // Currently selected main record
  const currentMainRecord = useMemo(() => {
    if (!selectedRgpNo) return null;
    const targetNorm = normalizeRgpNo(selectedRgpNo);
    const targetSeq = parseRgpSeq(selectedRgpNo);

    return rgpMainData.find((row) => {
      const rNo = normalizeRgpNo(row["RGP No"] || row["RGP No."]);
      if (rNo === targetNorm) return true;
      if (targetSeq !== null && parseRgpSeq(rNo) === targetSeq) return true;
      return false;
    }) || null;
  }, [rgpMainData, selectedRgpNo]);

  // Currently matching item records from Fabric_RGP_Items
  const currentItemRecords = useMemo(() => {
    if (!currentMainRecord) return [];
    const mainRgpNo = currentMainRecord["RGP No"] || currentMainRecord["RGP No."];
    const targetNorm = normalizeRgpNo(mainRgpNo);

    return rgpItemsData.filter((item) => {
      const iRgpNo = normalizeRgpNo(item["RGP No"] || item["RGP No."]);
      return iRgpNo === targetNorm;
    });
  }, [currentMainRecord, rgpItemsData]);

  // Build standard payload for generateRgpPDF
  const buildPdfPayload = () => {
    if (!currentMainRecord) return null;

    const rgpNo = currentMainRecord["RGP No"] || currentMainRecord["RGP No."];

    const entries = currentItemRecords.length > 0
      ? currentItemRecords.map((r) => ({
          lotNo: r["Lot No "] || r["Lot No"] || r["Lot"] || "",
          itemDesc: r["Description"] || r["Item Description"] || "",
          qty1: Number(r["Qty1"]) || Number(r["Qty"]) || 0,
          qty2: Number(r["Qty2"]) || Number(r["Bags"]) || 0,
          uom: r["UOM"] || currentMainRecord["UOM"] || "",
          department: r["Department"] || currentMainRecord["Department"] || "",
          purpose: r["Purpose"] || currentMainRecord["Purpose"] || "",
        }))
      : [{
          lotNo: "",
          itemDesc: currentMainRecord["Item Description"] || "",
          qty1: Number(currentMainRecord["Quantity Sent"]) || Number(currentMainRecord["Qty"]) || 0,
          qty2: 0,
          uom: currentMainRecord["UOM"] || "",
          department: currentMainRecord["Department"] || "",
          purpose: currentMainRecord["Purpose"] || "",
        }];

    return {
      rgpNo: rgpNo,
      date: currentMainRecord["Date"] || "",
      rgpType: currentMainRecord["RGP Type"] || "Fabric",
      vendor: currentMainRecord["Vendor / Party"] || currentMainRecord["Vendor"] || currentMainRecord["Party"] || "",
      expectedReturnDate: currentMainRecord["Expected Return Date"] || "",
      vehicleNo: currentMainRecord["Vehicle No"] || currentMainRecord["Vehicle No."] || "",
      preparedBy: currentMainRecord["Prepared By"] || "",
      authorizedBy: currentMainRecord["Authorized By"] || "",
      remarks: currentMainRecord["Remarks"] || "",
      entries: entries,
    };
  };

  // Helper to generate PDF document with QR codes
  const generatePdfDocObj = async () => {
    const payload = buildPdfPayload();
    if (!payload) throw new Error("No RGP selected or payload is invalid");

    const assignedRgpNo = payload.rgpNo;
    const baseUrl = WEB_APP_URL;
    const entryUrl = `${baseUrl}?mode=entry&rgp=${encodeURIComponent(assignedRgpNo)}`;
    const returnUrl = `${baseUrl}?mode=return&rgp=${encodeURIComponent(assignedRgpNo)}`;

    let entryQR, returnQR;
    try { entryQR = await generateQRCode(entryUrl); } catch (e) { console.warn("Entry QR error:", e); }
    try { returnQR = await generateQRCode(returnUrl); } catch (e) { console.warn("Return QR error:", e); }

    let entryQRDataUrl = entryQR, returnQRDataUrl = returnQR;
    if (entryQR && entryQR.startsWith('blob:')) {
      try { entryQRDataUrl = await toDataURL(entryQR); } catch (e) { console.warn("Entry QR blob convert error:", e); }
    }
    if (returnQR && returnQR.startsWith('blob:')) {
      try { returnQRDataUrl = await toDataURL(returnQR); } catch (e) { console.warn("Return QR blob convert error:", e); }
    }

    return generateRgpPDF({
      payload,
      options: {
        qrEntryImage: entryQRDataUrl,
        qrReturnImage: returnQRDataUrl
      }
    });
  };

  // Download PDF file
  const handleDownloadPdf = async () => {
    if (!currentMainRecord || generatingPdf) return;
    setGeneratingPdf(true);
    try {
      const pdfDoc = await generatePdfDocObj();
      const rgpNo = currentMainRecord["RGP No"] || currentMainRecord["RGP No."];
      const safeNo = rgpNo.replace(/[^\w\-]+/g, "-");
      pdfDoc.save(`RGP-${safeNo}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
      alert(`❌ Failed to generate PDF: ${err.message}`);
    } finally {
      setGeneratingPdf(false);
    }
  };

  // Open Preview Modal
  const handlePreviewPdf = async () => {
    if (!currentMainRecord || generatingPdf) return;
    setGeneratingPdf(true);
    try {
      const pdfDoc = await generatePdfDocObj();
      const blob = pdfDoc.output("blob");
      const url = URL.createObjectURL(blob);
      setPreviewPdfUrl(url);
      setShowPreviewModal(true);
    } catch (err) {
      console.error("Preview PDF failed:", err);
      alert(`❌ Failed to preview PDF: ${err.message}`);
    } finally {
      setGeneratingPdf(false);
    }
  };

  const closePreviewModal = () => {
    setShowPreviewModal(false);
    if (previewPdfUrl) {
      URL.revokeObjectURL(previewPdfUrl);
      setPreviewPdfUrl(null);
    }
  };

  const handleBackNavigation = () => {
    if (typeof onBack === "function") return onBack();
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  return (
    <div className="redownload-rgp-root">
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }

        .redownload-rgp-root {
          min-height: 100vh;
          background-color: #f8fafc;
          background-image: 
            radial-gradient(at 0% 0%, rgba(2, 132, 199, 0.04) 0px, transparent 50%), 
            radial-gradient(at 100% 100%, rgba(37, 99, 235, 0.04) 0px, transparent 50%);
          color: #0f172a;
          font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
          padding: 32px 24px;
        }

        .redownload-container {
          max-width: 1400px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 28px;
        }

        /* Top Header */
        .redownload-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #ffffff;
          padding: 24px 32px;
          border-radius: 20px;
          border: 1px solid rgba(2, 132, 199, 0.1);
          box-shadow: 0 10px 30px rgba(0, 41, 107, 0.04);
        }

        .header-title-box h1 {
          font-size: 24px;
          font-weight: 800;
          color: #0284c7;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .header-title-box p {
          font-size: 13px;
          color: #64748b;
          margin-top: 4px;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .btn-header {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #334155;
        }

        .btn-header:hover {
          background: #f1f5f9;
          border-color: #0284c7;
          color: #0284c7;
          transform: translateY(-1px);
        }

        .btn-header-primary {
          background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
          color: white;
          border: none;
          box-shadow: 0 4px 14px rgba(2, 132, 199, 0.3);
        }

        .btn-header-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(2, 132, 199, 0.4);
          background: linear-gradient(135deg, #0369a1 0%, #075985 100%);
          color: white;
        }

        /* Search & Control Panel */
        .control-panel {
          background: #ffffff;
          padding: 24px 32px;
          border-radius: 20px;
          border: 1px solid rgba(2, 132, 199, 0.1);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
          display: grid;
          grid-template-columns: 2fr 1fr auto;
          gap: 20px;
          align-items: end;
        }

        .field-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .field-label {
          font-size: 12px;
          font-weight: 700;
          color: #334155;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .input-text, .select-input {
          height: 48px;
          border-radius: 12px;
          border: 1.5px solid #cbd5e1;
          padding: 0 16px;
          font-size: 14px;
          font-weight: 600;
          color: #0f172a;
          outline: none;
          transition: all 0.2s ease;
          background: #ffffff;
        }

        .input-text:focus, .select-input:focus {
          border-color: #0284c7;
          box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
        }

        /* Main Workspace Layout */
        .workspace-grid {
          display: grid;
          grid-template-columns: 380px 1fr;
          gap: 28px;
        }

        /* Side RGP List */
        .rgp-list-card {
          background: #ffffff;
          border-radius: 20px;
          border: 1px solid rgba(2, 132, 199, 0.1);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
          display: flex;
          flex-direction: column;
          max-height: 680px;
          overflow: hidden;
        }

        .list-card-header {
          padding: 18px 24px;
          border-bottom: 1px solid #e2e8f0;
          background: #f8fafc;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .list-card-header h3 {
          font-size: 14px;
          font-weight: 800;
          color: #0369a1;
        }

        .badge-count {
          background: #e0f2fe;
          color: #0369a1;
          font-size: 11px;
          font-weight: 800;
          padding: 4px 10px;
          border-radius: 99px;
        }

        .list-items-container {
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .rgp-item-row {
          padding: 14px 16px;
          border-radius: 14px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .rgp-item-row:hover {
          border-color: #0284c7;
          background: #f0f9ff;
          transform: translateX(3px);
        }

        .rgp-item-row.active {
          border-color: #0284c7;
          background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
          box-shadow: 0 4px 12px rgba(2, 132, 199, 0.12);
        }

        .item-row-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .item-rgp-no {
          font-size: 14px;
          font-weight: 800;
          color: #0f172a;
        }

        .item-status {
          font-size: 10px;
          font-weight: 800;
          padding: 3px 8px;
          border-radius: 6px;
          text-transform: uppercase;
        }

        .status-active { background: #dcfce7; color: #166534; }
        .status-partial { background: #ffedd5; color: #9a3412; }
        .status-closed { background: #e0e7ff; color: #3730a3; }

        .item-row-bottom {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: #64748b;
        }

        /* Detail & Action View */
        .detail-panel {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .detail-card {
          background: #ffffff;
          border-radius: 20px;
          border: 1px solid rgba(2, 132, 199, 0.1);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
          padding: 28px;
        }

        .detail-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 2px dashed #e2e8f0;
          padding-bottom: 20px;
          margin-bottom: 20px;
        }

        .detail-rgp-title {
          font-size: 20px;
          font-weight: 800;
          color: #0369a1;
        }

        .detail-actions {
          display: flex;
          gap: 12px;
        }

        .grid-info {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
          margin-bottom: 24px;
        }

        .info-block {
          background: #f8fafc;
          padding: 14px 18px;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
        }

        .info-block-lbl {
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
        }

        .info-block-val {
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
          margin-top: 4px;
        }

        /* Table */
        .items-table-wrapper {
          overflow-x: auto;
          border-radius: 14px;
          border: 1px solid #e2e8f0;
        }

        .items-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }

        .items-table th {
          background: #0369a1;
          color: white;
          padding: 12px 16px;
          text-align: left;
          font-weight: 700;
          font-size: 12px;
          text-transform: uppercase;
        }

        .items-table td {
          padding: 12px 16px;
          border-bottom: 1px solid #e2e8f0;
          color: #334155;
          font-weight: 600;
        }

        .items-table tr:last-child td {
          border-bottom: none;
        }

        .empty-state {
          padding: 60px 20px;
          text-align: center;
          color: #64748b;
        }

        .empty-state-icon {
          font-size: 48px;
          margin-bottom: 12px;
        }

        /* Preview Modal */
        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(15, 23, 42, 0.7);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 20px;
        }

        .modal-container {
          background: #ffffff;
          border-radius: 24px;
          width: 90%;
          max-width: 1100px;
          height: 85vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
        }

        .modal-header {
          padding: 20px 28px;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .modal-header h2 {
          font-size: 18px;
          font-weight: 800;
          color: #0369a1;
        }

        .modal-close-btn {
          background: none;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          width: 36px;
          height: 36px;
          cursor: pointer;
          font-weight: 800;
          color: #64748b;
        }

        .modal-body {
          flex: 1;
          background: #f1f5f9;
          padding: 16px;
        }

        .modal-iframe {
          width: 100%;
          height: 100%;
          border: none;
          border-radius: 12px;
        }
      `}</style>

      <div className="redownload-container">
        {/* Top Header */}
        <div className="redownload-header">
          <div className="header-title-box">
            <h1>📥 Redownload RGP Document</h1>
            <p>Fetch gate pass records directly from Fabric_RGP & Fabric_RGP_Items sheets and regenerate original PDF files.</p>
          </div>

          <div className="header-actions">
            <button className="btn-header" onClick={handleBackNavigation}>
              ← Back
            </button>
            <button className="btn-header" onClick={fetchAllData} disabled={loading}>
              {loading ? "⏳ Syncing..." : "🔄 Refresh Data"}
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", padding: "14px 20px", borderRadius: "14px", fontWeight: "600" }}>
            ⚠️ {error}
          </div>
        )}

        {/* Search & Selector Control Panel */}
        <div className="control-panel">
          <div className="field-group">
            <label className="field-label">Search RGP Number / Vendor / Dept</label>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. RGP/2025/0001 or 0001..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="field-group">
            <label className="field-label">Select RGP Record</label>
            <select
              className="select-input"
              value={selectedRgpNo}
              onChange={(e) => setSelectedRgpNo(e.target.value)}
            >
              {filteredMainRecords.map((r, i) => {
                const no = r["RGP No"] || r["RGP No."];
                const vendor = r["Vendor / Party"] || r["Vendor"] || "";
                return (
                  <option key={i} value={no}>
                    {no} {vendor ? `(${vendor})` : ""}
                  </option>
                );
              })}
            </select>
          </div>

          <button
            className="btn-header btn-header-primary"
            style={{ height: "48px", padding: "0 24px" }}
            onClick={handleDownloadPdf}
            disabled={!currentMainRecord || generatingPdf}
          >
            {generatingPdf ? "⏳ Generating..." : "📄 Download PDF"}
          </button>
        </div>

        {/* Workspace Layout */}
        <div className="workspace-grid">
          {/* Left Column: Filtered List */}
          <div className="rgp-list-card">
            <div className="list-card-header">
              <h3>Available RGP Records</h3>
              <span className="badge-count">{filteredMainRecords.length} records</span>
            </div>

            <div className="list-items-container">
              {loading ? (
                <div className="empty-state">
                  <div className="empty-state-icon">⏳</div>
                  <p>Loading sheet data...</p>
                </div>
              ) : filteredMainRecords.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">🔍</div>
                  <p>No matching RGP records found.</p>
                </div>
              ) : (
                filteredMainRecords.map((r, idx) => {
                  const no = r["RGP No"] || r["RGP No."];
                  const status = (r["Status"] || "ACTIVE").toLowerCase();
                  const isSelected = selectedRgpNo === no;

                  return (
                    <div
                      key={idx}
                      className={`rgp-item-row ${isSelected ? "active" : ""}`}
                      onClick={() => setSelectedRgpNo(no)}
                    >
                      <div className="item-row-top">
                        <span className="item-rgp-no">{no}</span>
                        <span className={`item-status status-${status}`}>
                          {r["Status"] || "Active"}
                        </span>
                      </div>
                      <div className="item-row-bottom">
                        <span>{r["Vendor / Party"] || r["Vendor"] || "N/A"}</span>
                        <span>{r["Date"] || ""}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Record Details & Actions */}
          <div className="detail-panel">
            {currentMainRecord ? (
              <div className="detail-card">
                <div className="detail-card-header">
                  <div>
                    <h2 className="detail-rgp-title">
                      {currentMainRecord["RGP No"] || currentMainRecord["RGP No."]}
                    </h2>
                    <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                      Created on: {currentMainRecord["Date"] || "N/A"}
                    </p>
                  </div>

                  <div className="detail-actions">
                    <button
                      className="btn-header"
                      onClick={handlePreviewPdf}
                      disabled={generatingPdf}
                    >
                      👁️ Preview PDF
                    </button>
                    <button
                      className="btn-header btn-header-primary"
                      onClick={handleDownloadPdf}
                      disabled={generatingPdf}
                    >
                      {generatingPdf ? "⏳ Preparing PDF..." : "📥 Download PDF"}
                    </button>
                  </div>
                </div>

                {/* Metadata Grid */}
                <div className="grid-info">
                  <div className="info-block">
                    <div className="info-block-lbl">Party / Vendor</div>
                    <div className="info-block-val">
                      {currentMainRecord["Vendor / Party"] || currentMainRecord["Vendor"] || "N/A"}
                    </div>
                  </div>

                  <div className="info-block">
                    <div className="info-block-lbl">RGP Type</div>
                    <div className="info-block-val">
                      {currentMainRecord["RGP Type"] || "Fabric"}
                    </div>
                  </div>

                  <div className="info-block">
                    <div className="info-block-lbl">Department</div>
                    <div className="info-block-val">
                      {currentMainRecord["Department"] || "N/A"}
                    </div>
                  </div>

                  <div className="info-block">
                    <div className="info-block-lbl">Expected Return</div>
                    <div className="info-block-val">
                      {currentMainRecord["Expected Return Date"] || "N/A"}
                    </div>
                  </div>

                  <div className="info-block">
                    <div className="info-block-lbl">Prepared By</div>
                    <div className="info-block-val">
                      {currentMainRecord["Prepared By"] || "N/A"}
                    </div>
                  </div>

                  <div className="info-block">
                    <div className="info-block-lbl">Authorized By</div>
                    <div className="info-block-val">
                      {currentMainRecord["Authorized By"] || "N/A"}
                    </div>
                  </div>

                  <div className="info-block">
                    <div className="info-block-lbl">Vehicle No</div>
                    <div className="info-block-val">
                      {currentMainRecord["Vehicle No"] || currentMainRecord["Vehicle No."] || "N/A"}
                    </div>
                  </div>

                  <div className="info-block">
                    <div className="info-block-lbl">Status</div>
                    <div className="info-block-val" style={{ textTransform: "capitalize" }}>
                      {currentMainRecord["Status"] || "Active"}
                    </div>
                  </div>
                </div>

                {/* Remarks if present */}
                {currentMainRecord["Remarks"] && (
                  <div style={{ background: "#fffbeb", border: "1px solid #fde68a", padding: "12px 16px", borderRadius: "12px", marginBottom: "24px", fontSize: "13px", color: "#92400e" }}>
                    <b>Remarks:</b> {currentMainRecord["Remarks"]}
                  </div>
                )}

                {/* Items Table */}
                <h3 style={{ fontSize: "15px", fontWeight: "800", color: "#0369a1", marginBottom: "12px" }}>
                  📦 RGP Items ({currentItemRecords.length > 0 ? currentItemRecords.length : 1})
                </h3>

                <div className="items-table-wrapper">
                  <table className="items-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Lot No</th>
                        <th>Department</th>
                        <th>Description</th>
                        <th>Purpose</th>
                        <th>UOM</th>
                        <th style={{ textAlign: "right" }}>Qty1</th>
                        <th style={{ textAlign: "right" }}>Qty2 / Bags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentItemRecords.length > 0 ? (
                        currentItemRecords.map((item, idx) => (
                          <tr key={idx}>
                            <td>{idx + 1}</td>
                            <td>{item["Lot No "] || item["Lot No"] || "-"}</td>
                            <td>{item["Department"] || currentMainRecord["Department"] || "-"}</td>
                            <td>{item["Description"] || item["Item Description"] || "-"}</td>
                            <td>{item["Purpose"] || currentMainRecord["Purpose"] || "-"}</td>
                            <td>{item["UOM"] || currentMainRecord["UOM"] || "-"}</td>
                            <td style={{ textAlign: "right" }}>{item["Qty1"] || item["Qty"] || 0}</td>
                            <td style={{ textAlign: "right" }}>{item["Qty2"] || item["Bags"] || 0}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td>1</td>
                          <td>-</td>
                          <td>{currentMainRecord["Department"] || "-"}</td>
                          <td>{currentMainRecord["Item Description"] || "-"}</td>
                          <td>{currentMainRecord["Purpose"] || "-"}</td>
                          <td>{currentMainRecord["UOM"] || "-"}</td>
                          <td style={{ textAlign: "right" }}>{currentMainRecord["Quantity Sent"] || currentMainRecord["Qty"] || 0}</td>
                          <td style={{ textAlign: "right" }}>0</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="detail-card empty-state">
                <div className="empty-state-icon">📋</div>
                <h3>No RGP Selected</h3>
                <p>Select an RGP number from the list or enter search criteria above.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PDF Preview Modal */}
      {showPreviewModal && previewPdfUrl && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <h2>👁️ RGP PDF Document Preview</h2>
              <button className="modal-close-btn" onClick={closePreviewModal}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <iframe
                src={previewPdfUrl}
                title="RGP PDF Preview"
                className="modal-iframe"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
