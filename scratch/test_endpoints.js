async function testHttpEndpoints() {
  const base = 'http://localhost:5000';
  const endpoints = [
    '/health',
    '/api/cutting-lots',
    '/api/reports/undesigned-cutting-lots',
    '/api/designs',
    '/api/purchase-orders',
    '/api/doori',
    '/api/approvals',
    '/api/next-po-number'
  ];
  console.log('Testing Backend HTTP API Endpoints:');
  for (const ep of endpoints) {
    try {
      const res = await fetch(base + ep);
      console.log(`  ${ep} => HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      console.log(`  ${ep} => FAILED: ${err.message}`);
    }
  }
}
testHttpEndpoints();
