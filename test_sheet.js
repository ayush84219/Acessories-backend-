const apiKey = 'AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk';
const spreadsheetId = '1BZ-ufmxeqa9XdU-jkuIgeNxHvhnYKjWj4UpnI3bHJKo';

async function checkPatterns() {
  const itemsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Fabric_RGP_Items!A1:Z?key=${apiKey}`;
  const res = await fetch(itemsUrl);
  const data = await res.json();
  const rows = data.values.slice(1);

  // Check how many have numbers in description when lot is blank or 1
  let descHasNumber = 0;
  const examplesDescNumber = [];

  rows.forEach(r => {
    const lot = String(r[2] || '').trim();
    const desc = String(r[3] || '').trim();
    if (!lot || lot === '1' || lot === '0' || lot === '-') {
      // Check if desc has a 4-6 digit number like lot number (e.g. 11000, 61035, 73001)
      const numMatch = desc.match(/\b\d{4,6}\b/);
      if (numMatch) {
        descHasNumber++;
        if (examplesDescNumber.length < 15) {
          examplesDescNumber.push({ rgp: r[0], line: r[1], lot, desc, matchedNum: numMatch[0] });
        }
      }
    }
  });

  console.log(`Desc has 4-6 digit lot number: ${descHasNumber}`);
  console.log('Examples:', examplesDescNumber);
}
checkPatterns().catch(console.error);
