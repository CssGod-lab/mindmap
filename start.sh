#!/bin/bash
cd "$(dirname "$0")"
npm install --production 2>/dev/null
node server.js
