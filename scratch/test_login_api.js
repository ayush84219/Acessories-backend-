async function testLogin() {
  const accounts = [
    { email: 'admin@gmail.com', password: '123456' },
    { email: 'test@gmail.com', password: '123456' },
    { email: 'demo@gmail.com', password: '123456' }
  ];
  for (const acc of accounts) {
    const res = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(acc)
    });
    const data = await res.json();
    console.log(`${acc.email} => HTTP ${res.status}: ${data.message || data.error} ${data.user ? `(Role: ${data.user.role})` : ''}`);
  }
}
testLogin();
