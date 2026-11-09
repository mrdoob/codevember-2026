#!/bin/sh
set -eu
cd "$(dirname "$0")"
emcc contacts.c -O3 -msimd128 -ffast-math --no-entry \
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_step_grains","_collide_grains","_update_height","_prepare_surface"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8","HEAPU32"]' \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web,node \
  -s INITIAL_MEMORY=67108864 -s ALLOW_MEMORY_GROWTH=0 -s FILESYSTEM=0 \
  -o contacts.js
