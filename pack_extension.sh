#!/bin/bash

# Cartella di output per l'estensione non pacchettizzata
OUTPUT_DIR="dist/Screeps-SC"

# Rimuovi la vecchia cartella se esiste
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# Copia i file escludendo quelli non necessari (come .git, .DS_Store, lo script stesso e dist)
rsync -a \
    --exclude=".git" \
    --exclude=".github" \
    --exclude=".DS_Store" \
    --exclude="pack_extension.sh" \
    --exclude="dist" \
    --exclude="*.zip" \
    ./ "$OUTPUT_DIR/"

echo "Estension copied in $OUTPUT_DIR"
echo "In Chrome: chrome://extensions -> Enable 'Developer mode' -> 'Load unpacked' -> choose from $OUTPUT_DIR"
