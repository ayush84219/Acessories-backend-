import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import "./PoDashboard.css";
import {
  generatePurchaseOrderPDF,
  downloadPdfBlob,
  buildPoQrUrls,
  toDataURL_QR
} from "./PurchaseOrderForm";

// Local Storage Keys
const PO_DASH_KEYS = {
  API_KEY: "po_dash_api_key",
  SPREADSHEET_ID: "po_dash_spreadsheet_id",
  GST_ENABLED: "po_dash_gst_enabled",
  GST_PERCENTAGE: "po_dash_gst_percentage",
  SHADE_ENABLED: "po_dash_shade_enabled"
};

// Default Values
const DEFAULT_API_KEY = "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk";
const DEFAULT_SPREADSHEET_ID = "1hy43mDxXtGVq4jeMV_NxX25Q7tnX55NnplN7eqpT74k";

export default function PoDashboard() {
  const navigate = useNavigate();

  // Settings State
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(PO_DASH_KEYS.API_KEY) || DEFAULT_API_KEY);
  const [spreadsheetId, setSpreadsheetId] = useState(() => localStorage.getItem(PO_DASH_KEYS.SPREADSHEET_ID) || DEFAULT_SPREADSHEET_ID);

  // PDF Options State
  const [gstEnabled, setGstEnabled] = useState(() => JSON.parse(localStorage.getItem(PO_DASH_KEYS.GST_ENABLED) || "false"));
  const [gstPercentage, setGstPercentage] = useState(() => parseFloat(localStorage.getItem(PO_DASH_KEYS.GST_PERCENTAGE) || "18"));
  const [shadeEnabled, setShadeEnabled] = useState(() => JSON.parse(localStorage.getItem(PO_DASH_KEYS.SHADE_ENABLED) || "false"));

  // Dialog State
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [tempApiKey, setTempApiKey] = useState(apiKey);
  const [tempSpreadsheetId, setTempSpreadsheetId] = useState(spreadsheetId);

  // Data State
  const [poMain, setPoMain] = useState([]);
  const [poItems, setPoItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedPoNumber, setSelectedPoNumber] = useState(null);

  // Search/Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [supplierFilter, setSupplierFilter] = useState("ALL");

  // PDF Generation loading state
  const [generatingPdf, setGeneratingPdf] = useState(false);

  // Fetch Sheets Data
  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const mainRange = "PO_Main!A:Q";
      const itemsRange = "PO_Items!A:I";

      // Fetch PO_Main
      const mainUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(mainRange)}?key=${apiKey}`;
      const mainRes = await fetch(mainUrl);
      if (!mainRes.ok) throw new Error(`Failed to fetch PO metadata: HTTP ${mainRes.status}`);
      const mainData = await mainRes.json();
      const mainRows = mainData.values || [];

      // Fetch PO_Items
      const itemsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(itemsRange)}?key=${apiKey}`;
      const itemsRes = await fetch(itemsUrl);
      if (!itemsRes.ok) throw new Error(`Failed to fetch PO items: HTTP ${itemsRes.status}`);
      const itemsData = await itemsRes.json();
      const itemsRows = itemsData.values || [];

      // Parse headers and rows
      if (mainRows.length === 0) {
        throw new Error("PO_Main sheet is empty");
      }

      const mainHeaders = mainRows[0].map(h => String(h || "").trim());
      const parsedMain = mainRows.slice(1).map((row, rIdx) => {
        const item = {};
        mainHeaders.forEach((header, cIdx) => {
          item[header] = row[cIdx] !== undefined ? String(row[cIdx]).trim() : "";
        });
        // Normalize values
        item["Total Amount"] = parseFloat(item["Total Amount"]) || 0;
        return item;
      }).filter(item => item["PO #"]);

      if (itemsRows.length === 0) {
        throw new Error("PO_Items sheet is empty");
      }

      const itemsHeaders = itemsRows[0].map(h => String(h || "").trim());
      const parsedItems = itemsRows.slice(1).map((row, rIdx) => {
        const item = {};
        itemsHeaders.forEach((header, cIdx) => {
          item[header] = row[cIdx] !== undefined ? String(row[cIdx]).trim() : "";
        });
        item["Qty"] = parseFloat(item["Qty"]) || 0;
        item["Rate"] = parseFloat(item["Rate"]) || 0;
        item["Amount"] = parseFloat(item["Amount"]) || (item["Qty"] * item["Rate"]);
        return item;
      }).filter(item => item["PO #"]);

      setPoMain(parsedMain);
      setPoItems(parsedItems);

      // Auto-select first PO if available and none selected
      if (parsedMain.length > 0 && !selectedPoNumber) {
        setSelectedPoNumber(parsedMain[0]["PO #"]);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to load sheets data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [apiKey, spreadsheetId]);

  // Handle settings update
  const saveSettings = () => {
    setApiKey(tempApiKey);
    setSpreadsheetId(tempSpreadsheetId);
    localStorage.setItem(PO_DASH_KEYS.API_KEY, tempApiKey);
    localStorage.setItem(PO_DASH_KEYS.SPREADSHEET_ID, tempSpreadsheetId);
    setShowSettingsDialog(false);
  };

  // Sync temp values when dialog opens
  useEffect(() => {
    if (showSettingsDialog) {
      setTempApiKey(apiKey);
      setTempSpreadsheetId(spreadsheetId);
    }
  }, [showSettingsDialog, apiKey, spreadsheetId]);

  // Sync pdf option values to localStorage
  useEffect(() => {
    localStorage.setItem(PO_DASH_KEYS.GST_ENABLED, JSON.stringify(gstEnabled));
    localStorage.setItem(PO_DASH_KEYS.GST_PERCENTAGE, gstPercentage.toString());
    localStorage.setItem(PO_DASH_KEYS.SHADE_ENABLED, JSON.stringify(shadeEnabled));
  }, [gstEnabled, gstPercentage, shadeEnabled]);

  // Selected PO full details
  const selectedPO = useMemo(() => {
    if (!selectedPoNumber) return null;
    return poMain.find(po => po["PO #"] === selectedPoNumber) || null;
  }, [poMain, selectedPoNumber]);

  // Line items matching selected PO
  const selectedPOItems = useMemo(() => {
    if (!selectedPoNumber) return [];
    return poItems.filter(item => item["PO #"] === selectedPoNumber);
  }, [poItems, selectedPoNumber]);

  // Unique suppliers list for filter dropdown
  const uniqueSuppliers = useMemo(() => {
    const suppliers = new Set(poMain.map(po => po["Supplier"]).filter(Boolean));
    return ["ALL", ...Array.from(suppliers).sort()];
  }, [poMain]);

  // Filtered PO records for list pane
  const filteredPOs = useMemo(() => {
    return poMain.filter(po => {
      const poNo = String(po["PO #"] || "").toLowerCase();
      const supplier = String(po["Supplier"] || "").toLowerCase();
      const status = String(po["Status"] || "").toUpperCase();

      // Search Query filter
      const matchesSearch = poNo.includes(searchQuery.toLowerCase()) ||
        supplier.includes(searchQuery.toLowerCase());

      // Status Tab filter
      const matchesStatus = statusFilter === "ALL" || status === statusFilter;

      // Supplier Dropdown filter
      const matchesSupplier = supplierFilter === "ALL" || po["Supplier"] === supplierFilter;

      return matchesSearch && matchesStatus && matchesSupplier;
    });
  }, [poMain, searchQuery, statusFilter, supplierFilter]);

  // Dashboard Stats Calculations
  const stats = useMemo(() => {
    const total = poMain.length;
    const spend = poMain.reduce((sum, po) => sum + (parseFloat(po["Total Amount"]) || 0), 0);
    const approved = poMain.filter(po => ["APPROVED", "COMPLETED", "RECEIVED"].includes(String(po["Status"]).toUpperCase())).length;
    const pending = poMain.filter(po => ["PENDING", "ACTIVE", "DRAFT", "ISSUED"].includes(String(po["Status"]).toUpperCase())).length;
    return { total, spend, approved, pending };
  }, [poMain]);

  // PDF Regeneration Trigger
  const handleRegeneratePdf = async () => {
    if (!selectedPO) return;
    setGeneratingPdf(true);
    try {
      const poNo = selectedPO["PO #"];

      // Constants match defaults from form
      const WEB_APP_BASE = "https://script.google.com/macros/s/AKfycbydY5UUXgbyseONnQvnrWldDpmxzRH_m9crbMMhyTapZZ4flbV6AztESNjmusoH1xAluA/exec";
      const company = {
        name: "StitchPro Pvt. Ltd.",
        address: "Plot 42, Industrial Area, Jaipur, RJ",
        gstin: "08AABCS1234F1Z2",
        phone: "+91 98765 43210",
        email: "accounts@stitchpro.example",
      };

      // Construct URLs and QR images
      const supervisorName = selectedPO["Supervisor"] || selectedPO["REQUISITION RAISED BY"] || "";
      const { gateUrl, recvUrl } = buildPoQrUrls({
        base: WEB_APP_BASE,
        poNo,
        orderDate: selectedPO["Order Date"],
        expectedDate: selectedPO["Expected Date"],
        supervisorName,
      });

      let gateQR = null;
      let recvQR = null;

      try {
        const qrResults = await Promise.all([
          toDataURL_QR(gateUrl, 320),
          toDataURL_QR(recvUrl, 320)
        ]);
        gateQR = qrResults[0];
        recvQR = qrResults[1];
      } catch (qrErr) {
        console.warn("Failed to generate QR codes:", qrErr);
      }

      // Reconstruct payload totals structure
      const subtotal = selectedPOItems.reduce((sum, item) => sum + (parseFloat(item["Amount"]) || 0), 0);
      const calculatedGst = gstEnabled ? (subtotal * gstPercentage) / 100 : 0;
      const grandTotal = subtotal + calculatedGst;

      const payload = {
        meta: {
          poNumber: poNo,
          orderDate: selectedPO["Order Date"] || null,
          orderTime: selectedPO["Order Time"] || null,
          expectedDate: selectedPO["Expected Date"] || null,
          expectedTime: selectedPO["Expected Time"] || null,
          leadTimeMs: parseFloat(selectedPO["Lead Time (ms)"]) || null,
          leadTimeHuman: selectedPO["Lead Time (human)"] || null,
          requisitionRaisedBy: selectedPO["REQUISITION RAISED BY"] || null,
          preparedBy: selectedPO["Supervisor"] || null,
          approvedBy: selectedPO["AUTHORIZED BY"] || null,
          remarks: selectedPO["Remarks"] || "",
          createdAt: selectedPO["Created At"] || new Date().toISOString(),
          shadeEnabled,
          gstEnabled,
          gstPercentage: gstEnabled ? gstPercentage : 0
        },
        company,
        supplierName: selectedPO["Supplier"] || "N/A",
        rows: selectedPOItems.map((item, idx) => ({
          line: parseInt(item["Line #"]) || idx + 1,
          department: item["Department"] || "",
          description: item["Description"] || "",
          shade: item["Shade"] || "",
          uom: item["UOM"] || "PCS",
          qty: parseFloat(item["Qty"]) || 0,
          rate: parseFloat(item["Rate"]) || 0,
          amount: parseFloat(item["Amount"]) || 0
        })),
        totals: {
          sub: subtotal,
          discountTotal: 0,
          taxTotal: 0,
          gstAmount: calculatedGst,
          gstPercentage: gstEnabled ? gstPercentage : 0,
          gross: subtotal,
          payable: grandTotal,
          grandTotal: grandTotal,
          roundAdj: 0
        }
      };

      const doc = generatePurchaseOrderPDF({
        payload,
        options: {
          qrGateImage: gateQR,
          qrRecvImage: recvQR,
          qrSide: 96,
          shadeEnabled,
          gstEnabled,
          gstPercentage: gstEnabled ? gstPercentage : 0
        }
      });

      downloadPdfBlob(doc, `${poNo}.pdf`);
    } catch (e) {
      console.error(e);
      alert(`Could not regenerate PDF:\n${e.message || String(e)}`);
    } finally {
      setGeneratingPdf(false);
    }
  };

  const getBadgeClass = (status) => {
    if (!status) return "";
    const s = String(status).toUpperCase();
    if (["APPROVED", "COMPLETED", "RECEIVED"].includes(s)) return "status-approved";
    if (["PENDING", "ACTIVE", "ISSUED"].includes(s)) return "status-pending";
    if (s === "DRAFT") return "status-draft";
    return "status-cancelled";
  };

  return (
    <div className="po-dash-container" id="po-dash-root">
      {/* Header bar */}
      <div className="po-dash-appbar">
        <div className="po-dash-appbar-inner">
          <div className="po-dash-logo-section">
            <span className="po-dash-logo-icon" role="img" aria-label="Dashboard Logo">📋</span>
            <span className="po-dash-logo-text">PO Dashboard & PDF Generator</span>
          </div>
          <button onClick={() => navigate("/")} className="po-dash-back-btn">
            ← Home Dashboard
          </button>
        </div>
      </div>

      {/* Page Content wrapper */}
      <main className="po-dash-content">
        {/* Quick analytics counters */}
        {/* <section className="po-dash-stats-grid" id="po-dash-stats">
          <div className="po-dash-stat-card">
            <div className="po-dash-stat-icon-wrapper">📦</div>
            <div className="po-dash-stat-info">
              <span className="po-dash-stat-label">Total POs</span>
              <span className="po-dash-stat-value">{stats.total}</span>
            </div>
          </div>
          <div className="po-dash-stat-card stat-info">
            <div className="po-dash-stat-icon-wrapper">₹</div>
            <div className="po-dash-stat-info">
              <span className="po-dash-stat-label">Total Amount</span>
              <span className="po-dash-stat-value">
                {stats.spend.toLocaleString("en-IN", {
                  style: "currency",
                  currency: "INR",
                  maximumFractionDigits: 0
                })}
              </span>
            </div>
          </div>
          <div className="po-dash-stat-card stat-success">
            <div className="po-dash-stat-icon-wrapper">✅</div>
            <div className="po-dash-stat-info">
              <span className="po-dash-stat-label">Approved / Received</span>
              <span className="po-dash-stat-value">{stats.approved}</span>
            </div>
          </div>
          <div className="po-dash-stat-card stat-warning">
            <div className="po-dash-stat-icon-wrapper">⏳</div>
            <div className="po-dash-stat-info">
              <span className="po-dash-stat-label">Pending / Draft</span>
              <span className="po-dash-stat-value">{stats.pending}</span>
            </div>
          </div>
        </section> */}

        {/* Global Error Banner */}
        {error && (
          <div className="po-dash-error-card" id="po-dash-error">
            <span role="img" aria-label="Error icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Main interactive area */}
        <div className="po-dash-split-layout">

          {/* Left Pane: PO Search & List */}
          <aside className="po-dash-list-pane">
            <div className="po-dash-pane-header">
              <div className="po-dash-pane-title-row">
                <h2 className="po-dash-pane-title">
                  <span>📂</span> Purchase Orders ({filteredPOs.length})
                </h2>
                <button
                  onClick={() => setShowSettingsDialog(true)}
                  className="po-dash-config-toggle"
                  title="Configure Sheets Integration"
                >
                  ⚙️
                </button>
              </div>

              {/* Search Bar */}
              <div className="po-dash-search-box">
                <span className="po-dash-search-icon">🔍</span>
                <input
                  type="text"
                  className="po-dash-search-input"
                  placeholder="Search by PO # or Supplier..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Filters dropdown and tabs */}
              <div className="po-dash-filter-row">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="po-dash-filter-select"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="DRAFT">Draft</option>
                  <option value="PENDING">Pending</option>
                  <option value="APPROVED">Approved</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="RECEIVED">Received</option>
                </select>

                <select
                  value={supplierFilter}
                  onChange={(e) => setSupplierFilter(e.target.value)}
                  className="po-dash-filter-select"
                >
                  {uniqueSuppliers.map(sup => (
                    <option key={sup} value={sup}>{sup === "ALL" ? "All Suppliers" : sup}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* List list pane */}
            <div className="po-dash-list-scroll">
              {loading ? (
                <div className="po-dash-loading-wrapper">
                  <div className="po-dash-spinner"></div>
                  <div className="po-dash-loading-text">Fetching records...</div>
                </div>
              ) : filteredPOs.length === 0 ? (
                <div className="po-dash-empty-list">
                  <div className="po-dash-empty-icon">📂</div>
                  <div>No Purchase Orders match your filters.</div>
                </div>
              ) : (
                filteredPOs.map((po, index) => {
                  const poNo = po["PO #"];
                  const isActive = poNo === selectedPoNumber;
                  const amt = po["Total Amount"];
                  const dateStr = po["Order Date"] || po["Created At"] || "";
                  return (
                    <div
                      key={poNo || index}
                      onClick={() => setSelectedPoNumber(poNo)}
                      className={`po-dash-record-card ${isActive ? "active" : ""}`}
                    >
                      <div className="po-dash-card-header">
                        <span className="po-dash-card-po-no">{poNo}</span>
                        <span className={`po-dash-status-badge ${getBadgeClass(po["Status"])}`}>
                          {po["Status"] || "Draft"}
                        </span>
                      </div>
                      <div className="po-dash-card-supplier">
                        {po["Supplier"] || "Unknown Supplier"}
                      </div>
                      <div className="po-dash-card-details">
                        <span>{dateStr.split("T")[0]}</span>
                        <span className="po-dash-card-amount">
                          {amt > 0 ? `₹${amt.toLocaleString("en-IN")}` : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          {/* Right Pane: Selected PO Details */}
          <section className="po-dash-detail-pane">
            {!selectedPO ? (
              <div className="po-dash-detail-empty-state">
                <span className="po-dash-detail-empty-icon" role="img" aria-label="Folder icon">📁</span>
                <h3 className="po-dash-detail-empty-title">No Purchase Order Selected</h3>
                <p className="po-dash-detail-empty-desc">
                  Select a purchase order from the list on the left to inspect its details and download copies.
                </p>
              </div>
            ) : (
              <>
                {/* Header detail row */}
                <div className="po-dash-detail-header">
                  <div className="po-dash-detail-header-top">
                    <div className="po-dash-detail-title-wrapper">
                      <h1 className="po-dash-detail-title">{selectedPO["PO #"]}</h1>
                      <span className={`po-dash-status-badge ${getBadgeClass(selectedPO["Status"])}`}>
                        {selectedPO["Status"] || "Draft"}
                      </span>
                    </div>

                    <div className="po-dash-actions-row">
                      <button
                        onClick={handleRegeneratePdf}
                        disabled={generatingPdf || selectedPOItems.length === 0}
                        className="po-dash-action-btn"
                        id="po-regenerate-pdf-btn"
                      >
                        {generatingPdf ? (
                          <>⌛ Rebuilding PDF...</>
                        ) : (
                          <>🖨️ Regenerate PO PDF</>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="po-dash-detail-info-grid">
                    <div className="po-dash-info-block">
                      <span className="po-dash-info-label">Supplier</span>
                      <span className="po-dash-info-value">{selectedPO["Supplier"] || "N/A"}</span>
                    </div>
                    <div className="po-dash-info-block">
                      <span className="po-dash-info-label">Supervisor</span>
                      <span className="po-dash-info-value">{selectedPO["Supervisor"] || "N/A"}</span>
                    </div>
                    <div className="po-dash-info-block">
                      <span className="po-dash-info-label">Total Amount</span>
                      <span className="po-dash-info-value">
                        {selectedPO["Total Amount"] > 0
                          ? `₹${selectedPO["Total Amount"].toLocaleString("en-IN")}`
                          : `₹${selectedPOItems.reduce((sum, i) => sum + (parseFloat(i["Amount"]) || 0), 0).toLocaleString("en-IN")}`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Detail Information scrollable body */}
                <div className="po-dash-detail-scroll">

                  {/* Local PDF generation control options */}
                  <div className="po-dash-meta-section" style={{ gridTemplateColumns: "1fr", marginBottom: "16px" }}>
                    <div className="po-dash-detail-card" style={{ flexDirection: "row", flexWrap: "wrap", gap: "24px", alignItems: "center" }}>
                      <span className="po-dash-info-label" style={{ border: "none", padding: 0, margin: 0 }}>PDF Options:</span>

                      <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={gstEnabled}
                          onChange={(e) => setGstEnabled(e.target.checked)}
                          style={{ cursor: "pointer" }}
                        />
                        Include GST
                      </label>

                      {gstEnabled && (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "13px", color: "var(--po-muted)" }}>GST %:</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={gstPercentage}
                            onChange={(e) => setGstPercentage(parseFloat(e.target.value) || 0)}
                            style={{ width: "60px", padding: "4px 8px", border: "1px solid var(--po-line)", borderRadius: "4px", outline: "none" }}
                          />
                        </div>
                      )}

                      <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={shadeEnabled}
                          onChange={(e) => setShadeEnabled(e.target.checked)}
                          style={{ cursor: "pointer" }}
                        />
                        Include Shade Column
                      </label>
                    </div>
                  </div>

                  <div className="po-dash-meta-section">

                    {/* Time details card */}
                    <div className="po-dash-detail-card">
                      <h3 className="po-dash-card-title">Order Timeline</h3>
                      <div className="po-dash-kv-list">
                        <div className="po-dash-kv-row">
                          <span className="po-dash-key">Order Date & Time</span>
                          <span className="po-dash-value">
                            {[selectedPO["Order Date"], selectedPO["Order Time"]].filter(Boolean).join(" ")}
                          </span>
                        </div>
                        <div className="po-dash-kv-row">
                          <span className="po-dash-key">Expected Date & Time</span>
                          <span className="po-dash-value">
                            {[selectedPO["Expected Date"], selectedPO["Expected Time"]].filter(Boolean).join(" ")}
                          </span>
                        </div>
                        <div className="po-dash-kv-row">
                          <span className="po-dash-key">Lead Time</span>
                          <span className="po-dash-value">{selectedPO["Lead Time (human)"] || "—"}</span>
                        </div>
                        <div className="po-dash-kv-row">
                          <span className="po-dash-key">Created At</span>
                          <span className="po-dash-value">{selectedPO["Created At"] ? new Date(selectedPO["Created At"]).toLocaleString() : "—"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Metadata attributes card */}
                    <div className="po-dash-detail-card">
                      <h3 className="po-dash-title">Approval Signatures</h3>
                      <div className="po-dash-kv-list">
                        <div className="po-dash-kv-row">
                          <span className="po-dash-key">Requisition Raised By</span>
                          <span className="po-dash-value">{selectedPO["REQUISITION RAISED BY"] || "—"}</span>
                        </div>
                        <div className="po-dash-kv-row">
                          <span className="po-dash-key">Authorized By</span>
                          <span className="po-dash-value">{selectedPO["AUTHORIZED BY"] || "—"}</span>
                        </div>
                        <div className="po-dash-kv-row">
                          <span className="po-dash-key">Gate In Timestamp</span>
                          <span className="po-dash-value">{selectedPO["Gate In At"] || "Not Gate In Yet"}</span>
                        </div>
                        <div className="po-dash-kv-row">
                          <span className="po-dash-key">Received Timestamp</span>
                          <span className="po-dash-value">{selectedPO["Received At"] || "Not Received Yet"}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Line Items section */}
                  <div className="po-dash-items-section">
                    <h3 className="po-dash-items-title">PO Line Items ({selectedPOItems.length})</h3>
                    <div className="po-dash-table-wrapper">
                      <table className="po-dash-table">
                        <thead>
                          <tr>
                            <th className="align-center">Line #</th>
                            <th>Department</th>
                            <th>Description</th>
                            {shadeEnabled && <th>Shade</th>}
                            <th className="align-center">UOM</th>
                            <th className="align-right">Qty</th>
                            <th className="align-right">Rate</th>
                            <th className="align-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedPOItems.map((item, idx) => (
                            <tr key={item["Line #"] || idx}>
                              <td className="align-center">{item["Line #"] || (idx + 1)}</td>
                              <td>{item["Department"]}</td>
                              <td>{item["Description"]}</td>
                              {shadeEnabled && <td>{item["Shade"] || "—"}</td>}
                              <td className="align-center">{item["UOM"]}</td>
                              <td className="align-right">{parseFloat(item["Qty"] || 0).toLocaleString()}</td>
                              <td className="align-right">₹{parseFloat(item["Rate"] || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="align-right">₹{parseFloat(item["Amount"] || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            </tr>
                          ))}

                          {/* Totals row */}
                          <tr className="po-dash-table-total-row">
                            <td colSpan={shadeEnabled ? 5 : 4} className="align-right" style={{ fontWeight: 700 }}>Total Items Value:</td>
                            <td className="align-right" style={{ fontWeight: 700 }}>
                              {selectedPOItems.reduce((sum, item) => sum + (parseFloat(item["Qty"]) || 0), 0).toLocaleString()}
                            </td>
                            <td></td>
                            <td className="align-right" style={{ fontWeight: 700 }}>
                              ₹{selectedPOItems.reduce((sum, item) => sum + (parseFloat(item["Amount"]) || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>
              </>
            )}
          </section>

        </div>
      </main>

      {/* Sheets Config Dialog */}
      {showSettingsDialog && (
        <div className="po-dash-dialog-overlay" id="po-settings-overlay">
          <div className="po-dash-dialog">
            <div className="po-dash-dialog-header">
              <h3 className="po-dash-dialog-title">Configure Spreadsheet Integration</h3>
              <button onClick={() => setShowSettingsDialog(false)} className="po-dash-dialog-close">
                ×
              </button>
            </div>
            <div className="po-dash-dialog-body">
              <div className="po-dash-form-group">
                <label className="po-dash-form-label">Google Sheet Spreadsheet ID</label>
                <input
                  type="text"
                  value={tempSpreadsheetId}
                  onChange={(e) => setTempSpreadsheetId(e.target.value)}
                  className="po-dash-form-input"
                  placeholder="Enter spreadsheet ID..."
                />
              </div>
              <div className="po-dash-form-group">
                <label className="po-dash-form-label">Google API Key</label>
                <input
                  type="password"
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  className="po-dash-form-input"
                  placeholder="Enter API key..."
                />
              </div>
            </div>
            <div className="po-dash-dialog-footer">
              <button onClick={() => setShowSettingsDialog(false)} className="po-dash-btn-secondary">
                Cancel
              </button>
              <button onClick={saveSettings} className="po-dash-btn-primary">
                Save & Load
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
