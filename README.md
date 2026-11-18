# Keychain Password Manager

Keychain is an educational password manager built with Node.js. It combines the project's cryptographic keychain library with a local browser interface for saving and organizing account credentials. The app is intended for coursework and demonstration, not as a replacement for a production password manager.

## How it works

- **Master password and keys:** A random salt and PBKDF2 with SHA-256 derive a master key. HMAC derives separate keys for domain indexing and encryption; the master password and keys are not written to the vault.
- **Encrypted records:** Each credential is serialized and saved through `Keychain.set`. The domain identifier is HMAC-indexed, and the value is encrypted with AES-GCM using a fresh random IV. The HMAC index is also authenticated as additional data, so moving a ciphertext to a different index causes decryption to fail.
- **Length padding:** The Keychain pads each value to a fixed size before encryption. The UI stores a structured credential as one encrypted value, so the implementation uses a larger 4096-byte padded record for new entries and can still read the original 256-byte records.
- **Backup and integrity:** `dump()` serializes the encrypted vault and returns a SHA-256 checksum. The app saves the encrypted dump locally and can export or restore it. For rollback protection, a trusted copy of the checksum must be kept separately; a checksum stored beside the dump can be replaced along with it.

## Interface features

The local web UI includes a dashboard, password vault, favorites, secure password generator, security center, and settings. Credentials can be added, edited, searched, sorted, filtered, copied, and deleted. Passwords and usernames are masked in the vault list. The generator uses Node.js `crypto.randomInt`; security scores and password-strength labels are local estimates, not breach monitoring or guarantees of safety.

The Node server keeps the unlocked Keychain and decrypted records in memory. It writes only the encrypted dump to `.keychain-vault.json`. The vault locks after 15 minutes of inactivity or when you select **Lock vault**.

## Run it

From the `Proj1_Starter` directory:

```powershell
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The first visit creates a vault; later visits ask for its master password. Keep the terminal running while using the app.

Run the existing cryptography tests from the same directory with:

```powershell
npm test
```
