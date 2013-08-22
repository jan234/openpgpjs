/*-
 * Copyright (c) 2013  Peter Pentchev
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */

var openpgp_webcrypto = null;
var openpgp_webcrypto_subtle = null;

var openpgp_webcrypto_providers = {};
var openpgp_webcrypto_preferred_providers = [
	'browser',	/* native browser window.crypto.subtle support!	*/
	'nfwebcrypto',	/* Netflix's NfWebCrypto framework		*/
	'domcrypt',	/* Mozilla's domCrypt extension			*/
	'owncrypto'	/* OpenPGPjs's JavaScript PKI implementation	*/
];

function openpgp_webcrypto_provider_add(name, initfunc)
{
	openpgp_webcrypto_providers[name] = initfunc;
}

function openpgp_webcrypto_init(window, preferred)
{
	/* Make sure we have something... */
	if (preferred == null)
		preferred = openpgp_webcrypto_preferred_providers;

	/* Also accept a single provider name. */
	if (typeof preferred == 'string' || preferred instanceof String)
		preferred = [preferred];

	/* Well... go for it! */
	var res = null;
	for (var i = 0; i < preferred.length; i++) {
		var name = preferred[i];
		var initfunc = openpgp_webcrypto_providers[name];

		if (initfunc == null)
			continue;

		try {
			var r = initfunc(window);

			if (r == null || r.crypto == null || r.subtle == null)
				continue;

			/* Found it! */
			res = r;
			break;
		} catch (err) {
		}
	}

	if (res == null)
		throw 'openpgp_webcrypto_init(): could not find a suitable WebCrypto provider';

	openpgp_webcrypto = res.crypto;
	openpgp_webcrypto_subtle = res.subtle;
	return true;
}

function openpgp_browser_crypto_init(window)
{
	if (window.crypto == null || window.crypto.subtle == null)
		return null;
	return { crypto: window.crypto, subtle: window.crypto.subtle };
}

openpgp_webcrypto_provider_add('browser', openpgp_browser_crypto_init);

/**
 * @typedef {Object} openpgp_keypair
 * @property {WebCrypto.Key} privateKey 
 * @property {WebCrypto.Key} publicKey
 * @property {String} publicKeyArmored
 */

function openpgp_keypair()
{
	this.privateKey = null;
	this.publicKey = null;
	this.publicKeyArmored = null;
}

/**
 * @typedef {Object} openpgp_keypair_raw
 * @property {Integer} numBits
 * @property {Integer} symmetricEncryptionAlgorithm
 * @property {String} timePacket
 * @property {WebCrypto.Key} privateKey
 * @property {WebCrypto.Key} publicKey
 */

function openpgp_keypair_raw()
{
	this.numBits = null;
	this.symmetricEncryptionAlgorithm = null;
	this.timePacket = null;
	this.privateKey = null;
	this.publicKey = null;
}

function openpgp_crypto_exportKey(format, key) {
	var res = new openpgp_promise();

	if (key.opgp == null || key.opgp.provider == null ||
	    key.opgp.provider.subtle == null) {
		res._onerror('Not an openpgp_webcrypto generated key: ' + key);
		return res;
	}

	key.opgp.provider.subtle.exportKey(format, key).then(
		function (e) {
			try {
				res._oncomplete(e.target.result);
			} catch (err) {
				// FIXME: Bah, we don't really need this level of detail
				res._onerror("openpgp_crypto_exportKey.res._oncomplete failed: " + err);
			}
		},
		function (e) {
			res._onerror(e.target.result);
		});
	return res;
}

function openpgp_webcrypto_tag(key, numBits)
{
	if (key.opgp == null)
		key.opgp = {};

	key.opgp.numBits = numBits;

	key.opgp.provider = {
		/* TODO: name */
		crypto: openpgp_webcrypto,
		subtle: openpgp_webcrypto_subtle
	};
}

function openpgp_crypto_generateKeyPair(keyType, numBits, symmetricEncryptionAlgorithm)
{
	var d = new Date();
	d = d.getTime()/1000;
	var timePacket = String.fromCharCode(Math.floor(d/0x1000000%0x100)) + String.fromCharCode(Math.floor(d/0x10000%0x100)) + String.fromCharCode(Math.floor(d/0x100%0x100)) + String.fromCharCode(Math.floor(d%0x100));

	var res = new openpgp_promise();
	var algoSign, algoEnc;
	var signPair, encPair;
	
	switch (keyType) {
	case 1:
		algoSign = {
			name: 'RSASSA-PKCS1-v1_5',
			params: {
				modulusLength: numBits,
				publicExponent: new Uint8Array([0x01, 0x00, 0x01])
			}
		};
		algoEnc = {
			name: 'RSAES-PKCS1-v1_5',
			params: {
				modulusLength: numBits,
				publicExponent: new Uint8Array([0x01, 0x00, 0x01])
			}
		};
		break;
	
	default:
		res._onerror('Unknown key type ' + keyType);
		return res;
	}

	function pass_error(e) {
		if (e.target != null && e.target.result != null)
			res._onerror(e.target.result);
		else
			res._onerror(e);
	}

	function enc_generated(key) {
		switch (keyType) {
		case 1:
			encPair = new openpgp_keypair_raw();

			encPair.numBits = numBits;
			encPair.publicKey = key.target.result.publicKey;
			encPair.privateKey = key.target.result.privateKey;
			encPair.symmetricEncryptionAlgorithm = symmetricEncryptionAlgorithm;
			encPair.timePacket = timePacket;
			openpgp_webcrypto_tag(encPair.publicKey, numBits);
			openpgp_webcrypto_tag(encPair.privateKey, numBits);

			/* We're done, but ignore the encryption subkey for now. */
			res._oncomplete(signPair);
			break;
		default:
			res._onerror("We shouldn't have reached generateKeyPair.enc_generated() with an unknown key type " + keyType);
			break;
		}
	}

	function sign_generated(key) {
		switch (keyType) {
		case 1:
			signPair = new openpgp_keypair_raw();

			signPair.numBits = numBits;
			signPair.publicKey = key.target.result.publicKey;
			signPair.privateKey = key.target.result.privateKey;
			signPair.symmetricEncryptionAlgorithm = symmetricEncryptionAlgorithm;
			signPair.timePacket = timePacket;
			openpgp_webcrypto_tag(signPair.publicKey, numBits);
			openpgp_webcrypto_tag(signPair.privateKey, numBits);

			/* OK, just for kicks, generate an encryption subkey. */
			openpgp_webcrypto_subtle.generateKey(algoEnc, false, ["encrypt"]).then(enc_generated, pass_error);
			break;
		default:
			res._onerror("We shouldn't have reached generateKeyPair.sign_generated() with an unknown key type " + keyType);
			break;
		}
	}

	openpgp_webcrypto_subtle.generateKey(algoSign, false, ["sign"]).then(sign_generated, pass_error);
	return res;
}

/**
 * Create a signature on data using the specified algorithm
 * @param {Integer} hash_algo hash Algorithm to use (See RFC4880 9.4)
 * @param {Integer} algo Asymmetric cipher algorithm to use (See RFC4880 9.1)
 * @param {openpgp_type_mpi[]} publicMPIs Public key multiprecision integers 
 * of the private key 
 * @param {WebCrypto.Key} privateKey Private key used to sign the data
 * @param {String} data Data to be signed
 * @return {openpgp_promise} signed data (string)
 */
function openpgp_crypto_signData(hash_algo, algo, publicMPIs, privateKey, data) {
	var res = new openpgp_promise();
	var toMPI = false;
	
	if (privateKey.opgp == null || privateKey.opgp.provider == null ||
	    privateKey.opgp.provider.subtle == null) {
		res._onerror('Not an openpgp_webcrypto generated key: ' + privateKey);
		return res;
	}

	// FIXME: honor hash_algo, too :)

	var algorithm;

	switch(algo) {
	case 1: // RSA (Encrypt or Sign) [HAC]  
	case 2: // RSA Encrypt-Only [HAC]
	case 3: // RSA Sign-Only [HAC]
		algorithm = { name: 'RSASSA-PKCS1-v1_5', params: { hash: 'SHA-256' } };
		toMPI = true;
		break;
	case 17: // DSA (Digital Signature Algorithm) [FIPS186] [HAC]
		algorithm = { name: 'ECDSA', hash: { name: 'SHA-256' } };
		break;
	case 16: // Elgamal (Encrypt-Only) [ELGAMAL] [HAC]
		res._onerror("signing with Elgamal is not defined in the OpenPGP standard.");
		return res;
	default:
		res._onerror("unknown OpenPGP signing algorithm " + algo);
		return res;
	}	

	var sign = privateKey.opgp.provider.subtle.sign(algorithm, privateKey, util.str2Uint8Array(data));
	sign.oncomplete = function (e) {
		var r;
		if (!toMPI) {
			r = e.target.result;
		} else {
			var s = util.hexidump(e.target.result);
			var bi = new BigInteger(s, 16);
			r = bi.toMPI();
		}
		res._oncomplete(r);
	}
	sign.onerror = function (e) {
		res._onerror(e.target.result);
	}

	return res;
}