#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="$ROOT/.certs"
if [ "$#" -eq 0 ]; then
  echo "Usage: bash infra/setup-https.sh <LAN-IP> [additional-IP ...]" >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "Install OpenSSL before continuing." >&2; exit 1; }

san="DNS:localhost,IP:127.0.0.1,IP:::1"
for address in "$@"; do
  if [[ ! "$address" =~ ^[0-9a-fA-F:.]+$ ]]; then
    echo "Expected an IP address, got: $address" >&2
    exit 1
  fi
  san+=",IP:$address"
done

mkdir -p "$CERT_DIR"
work="$(mktemp -d "$CERT_DIR/setup.XXXXXX")"
cleanup() {
  rm -f "$work/ca-key.pem" "$work/ca.crt" "$work/server-key.pem" "$work/server.csr" "$work/server.pem"
  rmdir "$work"
}
trap cleanup EXIT

# Validate the SANs before creating a CA or replacing any certificates.
openssl req -new -newkey rsa:2048 -nodes \
  -keyout "$work/server-key.pem" -out "$work/server.csr" \
  -subj "/CN=TechPrep LAN" -addext "subjectAltName=$san"

if [ ! -f "$CERT_DIR/ca.crt" ] && [ ! -f "$CERT_DIR/ca-key.pem" ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 3650 \
    -keyout "$work/ca-key.pem" -out "$work/ca.crt" \
    -subj "/CN=TechPrep Local CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
  mv "$work/ca-key.pem" "$CERT_DIR/ca-key.pem"
  mv "$work/ca.crt" "$CERT_DIR/ca.crt"
elif [ ! -f "$CERT_DIR/ca.crt" ] || [ ! -f "$CERT_DIR/ca-key.pem" ]; then
  echo "Incomplete CA in $CERT_DIR. Restore the missing CA certificate or key before continuing." >&2
  exit 1
fi

openssl x509 -req -in "$work/server.csr" \
  -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca-key.pem" \
  -set_serial "0x$(openssl rand -hex 16)" -days 365 -sha256 \
  -extfile <(printf '%s\n' \
    "basicConstraints=critical,CA:FALSE" \
    "keyUsage=critical,digitalSignature,keyEncipherment" \
    "extendedKeyUsage=serverAuth" \
    "subjectAltName=$san") \
  -out "$work/server.pem"
openssl verify -CAfile "$CERT_DIR/ca.crt" "$work/server.pem"
mv "$work/server-key.pem" "$CERT_DIR/server-key.pem"
mv "$work/server.pem" "$CERT_DIR/server.pem"
chmod 644 "$CERT_DIR/ca.crt" "$CERT_DIR/server.pem"

echo "HTTPS certificates are ready. Start with: ./run.sh lan"
echo "Trust $CERT_DIR/ca.crt on each client device. Never copy the private key files."
