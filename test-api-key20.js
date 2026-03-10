const token = 'AQ.Ab8RN6LqBUldiIGNt_zW8hJLHqfdaisC_8LDwAJseq9c8v9tXg';

console.log('Testing GET sessions with URL params...');
const res = await fetch(`https://jules.googleapis.com/v1alpha/sessions?key=${token}`);
console.log('Status:', res.status, res.statusText);
if (!res.ok) {
  console.log(await res.text());
} else {
  console.log(await res.json());
}
