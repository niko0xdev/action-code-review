#!/bin/bash

# Build script for the GitHub Action

echo "🚀 Building AI Code Review Action..."

# Install dependencies
echo "📦 Installing dependencies..."
npm ci

# Run linting
echo "🔍 Running linting..."
npm run lint

# Run tests
echo "🧪 Running tests..."
npm test

# Build the action
echo "🏗️ Building the action..."
npm run build

echo "✅ Build completed successfully!"
echo "📁 The built action is available in the 'dist' directory."
