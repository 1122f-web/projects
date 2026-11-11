// Grants the administrator role to an existing account.
// Usage: npm run make-admin -- someone@example.com
// Requires SUPABASE_SERVICE_ROLE_KEY, so only people with server access can run it.
import { serviceClient } from '../lib/supabase.js';

const email = process.argv[2];
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: npm run make-admin -- <email>');
  process.exit(1);
}

const { data, error } = await serviceClient.rpc('grant_admin_by_email', { p_email: email });
if (error) {
  console.error(`Could not grant admin: ${error.message}`);
  process.exit(1);
}
console.warn(`Administrator role granted to ${email} (user ${data}). The change is recorded in audit_logs.`);
