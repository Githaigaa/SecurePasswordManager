# Keychain Password Manager

## Run the application

From `Proj1_Starter`, run:

```powershell
npm start
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173). The server binds to loopback only. The first visit lets you create a master password; later visits unlock the vault. The vault locks after 15 minutes without an API request, or immediately with the lock button.

## What is included

- A responsive dark UI for dashboard, vault, favorites, generator, security center, and settings.
- Credential add, edit, delete, search, category filtering, sorting, password reveal, and copy actions.
- Cryptographically secure password generation using Node.js `crypto.randomInt`.
- Local security insights for strength, duplicates, and completeness. No breach or threat checks are claimed.
- Encrypted JSON backup export and restore with the Keychain checksum verification.
- A local Node bridge that keeps the Keychain object, derived keys, and decrypted values in process memory. Only `dump()` output is persisted in `.keychain-vault.json`; that file is ignored by git.

## Storage format note

The starter Keychain allowed only short values, which cannot hold structured credentials. New encrypted records use a larger fixed-size padded payload. The loader still reads the original 256-byte padded records, so existing starter vault data remains readable. PBKDF2, AES-GCM, HMAC indexing, and dump checksums remain in the original Keychain implementation.

The vault file is encrypted, but a backup can be unlocked by anyone who also knows the master password. Store backups carefully. The application is a local project UI, not a packaged desktop application; closing the Node process clears the in-memory keychain and requires unlocking again.

## Tests

Run the existing starter suite from `Proj1_Starter` with `npm test`.
