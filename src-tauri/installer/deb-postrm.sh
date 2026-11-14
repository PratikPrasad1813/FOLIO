#!/bin/sh
# ==============================================================================
# Folio Desktop — Debian postrm hook
# (tauri.conf.json → bundle > linux > deb > postRemoveScript)
#
# Follows the Debian convention:
#   apt remove folio  → binaries go, LOCAL workspace data is kept
#                       (~/.config/com.folio.workspace — folio.db, session)
#   apt purge  folio  → binaries AND local workspace data are removed
#
# Data already synced to the user's Folio cloud account is unaffected.
# ==============================================================================

set -eu

if [ "$1" = "purge" ]; then
  # The maintainer script runs as root; clean every user profile's data dir.
  # Use find -maxdepth so a huge /home never stalls the removal.
  for home_dir in /home/* /root; do
    [ -d "$home_dir" ] || continue
    rm -rf "$home_dir/.config/com.folio.workspace" 2>/dev/null || true
    rm -rf "$home_dir/.local/share/com.folio.workspace" 2>/dev/null || true
  done
fi

exit 0
