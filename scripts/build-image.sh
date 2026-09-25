#!/bin/sh
set -e
VERSION=$(node -p "require('./package.json').version")
echo "building shiftboard-api:$VERSION"
docker build -t "shiftboard-api:$VERSION" .
