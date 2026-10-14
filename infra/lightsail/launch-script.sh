#!/bin/sh
# Lightsail launch script (Ubuntu 24.04): installs Docker and enables unattended security updates.
# Lightsail prepends its own commands and runs this with /bin/sh, so it must stay POSIX.
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl unattended-upgrades docker.io docker-compose-v2 sqlite3
systemctl enable --now docker
usermod -aG docker ubuntu
install -d -m 755 /srv/techprep/releases
# 2 GB swap so image builds do not exhaust memory on small plans.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
