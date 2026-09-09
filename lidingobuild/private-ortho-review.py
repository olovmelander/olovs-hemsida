"""Encrypt review pixels on the runner; only the local private key opens them.

No credentials enter this envelope. RSA-OAEP wraps a fresh AES-256-GCM key;
authenticated metadata and ciphertext reject tampering. Plaintext is never an
Actions artifact or a repository file. The public key is safe to commit.
"""
import hashlib
import json
import os
import struct
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b'LIDORT01'


def oaep():
    return padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)


def seal(payload, public_pem):
    public = serialization.load_pem_public_key(public_pem)
    key, nonce = AESGCM.generate_key(bit_length=256), os.urandom(12)
    header = json.dumps({'version': 1, 'algorithm': 'RSA-OAEP-SHA256+AES-256-GCM',
        'publicKeySha256': hashlib.sha256(public_pem).hexdigest(),
        'wrappedKey': public.encrypt(key, oaep()).hex(), 'nonce': nonce.hex()},
        sort_keys=True, separators=(',', ':')).encode()
    return MAGIC + struct.pack('>I', len(header)) + header + AESGCM(key).encrypt(nonce, payload, header)


def unseal(envelope, private_pem):
    if envelope[:8] != MAGIC:
        raise ValueError('Unknown review envelope')
    length = struct.unpack('>I', envelope[8:12])[0]
    if length > 4096:
        raise ValueError('Invalid review header')
    header = envelope[12:12+length]
    meta = json.loads(header)
    if meta['version'] != 1 or meta['algorithm'] != 'RSA-OAEP-SHA256+AES-256-GCM':
        raise ValueError('Unknown review encryption')
    private = serialization.load_pem_private_key(private_pem, password=None)
    public = private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    if hashlib.sha256(public).hexdigest() != meta['publicKeySha256']:
        raise ValueError('Review belongs to a different key')
    key = private.decrypt(bytes.fromhex(meta['wrappedKey']), oaep())
    return AESGCM(key).decrypt(bytes.fromhex(meta['nonce']), envelope[12+length:], header)
