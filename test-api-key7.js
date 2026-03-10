const token = 'AQ.Ab8RN6LqBUldiIGNt_zW8hJLHqfdaisC_8LDwAJseq9c8v9tXg';

async function test(headers, body) {
  const options = {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
  const res = await fetch(`https://jules.googleapis.com/v1alpha/sessions`, options);
  console.log('Status:', res.status, res.statusText);
  if (!res.ok) {
    console.log(await res.text());
  } else {
    console.log(await res.json());
  }
}

console.log('Testing no auth...');
await test({ }, { instruction: 'Test' });
