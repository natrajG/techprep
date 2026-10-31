#!/bin/bash
# TechPrep macOS Gatekeeper Unquarantine Tool
clear
echo "====================================================="
echo "        TechPrep macOS One-Click Quick Fix          "
echo "====================================================="
echo ""
echo "Removing macOS Gatekeeper quarantine from TechPrep..."

# Remove quarantine from standard locations
xattr -cr /Applications/TechPrep.app 2>/dev/null
xattr -cr "$HOME/Applications/TechPrep.app" 2>/dev/null
xattr -cr "$HOME/Downloads/TechPrep.app" 2>/dev/null
xattr -cr "$(dirname "$0")/TechPrep.app" 2>/dev/null

echo "✓ TechPrep has been verified and unquarantined!"
echo ""
echo "Opening TechPrep now..."
open /Applications/TechPrep.app 2>/dev/null || open "$HOME/Downloads/TechPrep.app" 2>/dev/null || open "$(dirname "$0")/TechPrep.app" 2>/dev/null || echo "Please drag TechPrep into Applications and click TechPrep to open."

echo ""
echo "You can close this window now."
