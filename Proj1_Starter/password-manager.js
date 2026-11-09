"use strict";

/********* External Imports ********/

const { stringToBuffer, bufferToString, encodeBuffer, decodeBuffer, getRandomBytes } = require("./lib");
const { subtle } = require('crypto').webcrypto;

/********* Constants ********/

const PBKDF2_ITERATIONS = 100000; // number of iterations for PBKDF2 algorithm
const MAX_PASSWORD_LENGTH = 64;   // we can assume no password is longer than this many characters

// Every plaintext is padded to exactly this many bytes before encryption, so all
// ciphertexts have the same length. A JS string of 64 UTF-16 code units is at most
// 192 bytes in UTF-8, so 256 bytes leaves room for a 1-byte length prefix.
const PADDED_SIZE = MAX_PASSWORD_LENGTH * 4;

const SALT_LENGTH = 16; // 128-bit salt
const IV_LENGTH = 12;   // 96-bit IV, the recommended size for AES-GCM

// Fixed, public labels used to derive independent sub-keys from the master key
// with HMAC acting as a PRF. They are not secret; the master key is.
const DOMAIN_KEY_LABEL = "keychain/domain-hmac-key";
const AES_KEY_LABEL = "keychain/aes-gcm-key";

// Known plaintext + AAD for the "is this the right master password?" check.
const CHECK_PLAINTEXT = "keychain/password-check";
const CHECK_AAD = "keychain/check";

const TAMPER_MSG = "Tampering detected!";

/********* Helpers ********/

/**
 * Derives the two sub-keys from the master password and salt.
 * PBKDF2 is called exactly once.
 * Returns { domainKey, aesKey } (CryptoKeys).
 */
async function deriveKeys(password, salt) {
  const passwordKey = await subtle.importKey(
    "raw", stringToBuffer(password), "PBKDF2", false, ["deriveKey"]);

  // Master key k, usable only as an HMAC key (PRF) and never exported.
  const masterKey = await subtle.deriveKey(
    { name: "PBKDF2", salt: salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    passwordKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"]);

  // Sub-keys = HMAC(k, label). Different labels give independent-looking keys.
  const domainMaterial = await subtle.sign("HMAC", masterKey, stringToBuffer(DOMAIN_KEY_LABEL));
  const aesMaterial = await subtle.sign("HMAC", masterKey, stringToBuffer(AES_KEY_LABEL));

  const domainKey = await subtle.importKey(
    "raw", domainMaterial, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const aesKey = await subtle.importKey(
    "raw", aesMaterial, "AES-GCM", false, ["encrypt", "decrypt"]);

  return { domainKey, aesKey };
}

/** Pads a string to PADDED_SIZE bytes: [1-byte length][data][zero padding]. */
function pad(str) {
  const bytes = stringToBuffer(str);
  if (bytes.length > PADDED_SIZE - 1 || str.length > MAX_PASSWORD_LENGTH) {
    throw "Value is too long!";
  }
  const out = new Uint8Array(PADDED_SIZE); // zero-filled
  out[0] = bytes.length;
  out.set(bytes, 1);
  return out;
}

/** Inverse of pad(). */
function unpad(buf) {
  const arr = new Uint8Array(buf);
  const len = arr[0];
  if (arr.length !== PADDED_SIZE || len > PADDED_SIZE - 1) {
    throw TAMPER_MSG;
  }
  return bufferToString(arr.slice(1, 1 + len));
}

/********* Implementation ********/
class Keychain {
  /**
   * Initializes the keychain using the provided information. Note that external
   * users should likely never invoke the constructor directly and instead use
   * either Keychain.init or Keychain.load. 
   * Arguments:
   *  data:    public state, safe for an adversary to see: { kvs, salt, check }
   *  secrets: private state, never serialized: { domainKey, aesKey }
   * Return Type: void
   */
  constructor(data, secrets) {
    this.data = data;       // { kvs, salt (base64), check: { iv, ct } }
    this.secrets = secrets; // { domainKey, aesKey }
  };

  /** HMAC of the domain name, Base64 encoded. This is the KVS key. */
  async _tag(name) {
    const mac = await subtle.sign("HMAC", this.secrets.domainKey, stringToBuffer(name));
    return encodeBuffer(mac);
  }

  /** Encrypts bytes under the AES key with a fresh random IV. */
  static async _encrypt(aesKey, plaintext, aad) {
    const iv = getRandomBytes(IV_LENGTH);
    const ct = await subtle.encrypt(
      { name: "AES-GCM", iv: iv, additionalData: stringToBuffer(aad) },
      aesKey, plaintext);
    return { iv: encodeBuffer(iv), ct: encodeBuffer(ct) };
  }

  /** Decrypts a { iv, ct } record. Throws if authentication fails. */
  static async _decrypt(aesKey, record, aad) {
    return subtle.decrypt(
      { name: "AES-GCM", iv: decodeBuffer(record.iv), additionalData: stringToBuffer(aad) },
      aesKey, decodeBuffer(record.ct));
  }

  /** 
    * Creates an empty keychain with the given password.
    *
    * Arguments:
    *   password: string
    * Return Type: void
    */
  static async init(password) {
    const salt = getRandomBytes(SALT_LENGTH);
    const { domainKey, aesKey } = await deriveKeys(password, salt);

    // Password verifier: an authenticated encryption of a known constant.
    const check = await Keychain._encrypt(aesKey, stringToBuffer(CHECK_PLAINTEXT), CHECK_AAD);

    return new Keychain(
      { kvs: {}, salt: encodeBuffer(salt), check: check },
      { domainKey, aesKey });
  }

  /**
    * Loads the keychain state from the provided representation (repr). The
    * repr variable will contain a JSON encoded serialization of the contents
    * of the KVS (as returned by the dump function). The trustedDataCheck
    * is an *optional* SHA-256 checksum that can be used to validate the 
    * integrity of the contents of the KVS. If the checksum is provided and the
    * integrity check fails, an exception should be thrown. You can assume that
    * the representation passed to load is well-formed (i.e., it will be
    * a valid JSON object).Returns a Keychain object that contains the data
    * from repr. 
    *
    * Arguments:
    *   password:           string
    *   repr:               string
    *   trustedDataCheck: string
    * Return Type: Keychain
    */
  static async load(password, repr, trustedDataCheck) {
    // Rollback defense: check the SHA-256 of the exact string we were handed.
    if (trustedDataCheck !== undefined) {
      const digest = encodeBuffer(await subtle.digest("SHA-256", stringToBuffer(repr)));
      if (digest !== trustedDataCheck) {
        throw TAMPER_MSG;
      }
    }

    const data = JSON.parse(repr);
    const { domainKey, aesKey } = await deriveKeys(password, decodeBuffer(data.salt));

    // Wrong password (or tampered check record) => authentication fails.
    let checkPlain;
    try {
      checkPlain = await Keychain._decrypt(aesKey, data.check, CHECK_AAD);
    } catch (e) {
      throw "Invalid password or corrupted keychain!";
    }
    if (bufferToString(checkPlain) !== CHECK_PLAINTEXT) {
      throw "Invalid password or corrupted keychain!";
    }

    return new Keychain(
      { kvs: data.kvs, salt: data.salt, check: data.check },
      { domainKey, aesKey });
  };

  /**
    * Returns a JSON serialization of the contents of the keychain that can be 
    * loaded back using the load function. The return value should consist of
    * an array of two strings:
    *   arr[0] = JSON encoding of password manager
    *   arr[1] = SHA-256 checksum (as a string)
    * As discussed in the handout, the first element of the array should contain
    * all of the data in the password manager. The second element is a SHA-256
    * checksum computed over the password manager to preserve integrity.
    *
    * Return Type: array
    */ 
  async dump() {
    const repr = JSON.stringify(this.data);
    const digest = await subtle.digest("SHA-256", stringToBuffer(repr));
    return [repr, encodeBuffer(digest)];
  };

  /**
    * Fetches the data (as a string) corresponding to the given domain from the KVS.
    * If there is no entry in the KVS that matches the given domain, then return
    * null.
    *
    * Arguments:
    *   name: string
    * Return Type: Promise<string>
    */
  async get(name) {
    const tag = await this._tag(name);
    if (!Object.prototype.hasOwnProperty.call(this.data.kvs, tag)) {
      return null;
    }
    let plain;
    try {
      // AAD = the record's own KVS key, so a record moved to another key fails here.
      plain = await Keychain._decrypt(this.secrets.aesKey, this.data.kvs[tag], tag);
    } catch (e) {
      throw TAMPER_MSG;
    }
    return unpad(plain);
  };

  /** 
  * Inserts the domain and associated data into the KVS. If the domain is
  * already in the password manager, this method should update its value. If
  * not, create a new entry in the password manager.
  *
  * Arguments:
  *   name: string
  *   value: string
  * Return Type: void
  */
  async set(name, value) {
    const tag = await this._tag(name);
    this.data.kvs[tag] = await Keychain._encrypt(this.secrets.aesKey, pad(value), tag);
  };

  /**
    * Removes the record with name from the password manager. Returns true
    * if the record with the specified name is removed, false otherwise.
    *
    * Arguments:
    *   name: string
    * Return Type: Promise<boolean>
  */
  async remove(name) {
    const tag = await this._tag(name);
    if (!Object.prototype.hasOwnProperty.call(this.data.kvs, tag)) {
      return false;
    }
    delete this.data.kvs[tag];
    return true;
  };
};

module.exports = { Keychain }