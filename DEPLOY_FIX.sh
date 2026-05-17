#!/bin/bash

# Quick deployment script for Analytics Response Fix
# Run this to deploy the fix immediately

set -e

echo "🔧 Deploying Analytics Response Fix..."
echo ""

# Step 1: Check TypeScript
echo "1️⃣  Checking TypeScript compilation..."
if npm run typecheck > /dev/null 2>&1; then
  echo "   ✅ TypeScript OK"
else
  echo "   ❌ TypeScript errors found!"
  npm run typecheck
  exit 1
fi

# Step 2: Build
echo ""
echo "2️⃣  Building project..."
npm run build
echo "   ✅ Build complete"

# Step 3: Stop containers
echo ""
echo "3️⃣  Stopping existing services..."
npm run docker:down
sleep 2

# Step 4: Start containers
echo ""
echo "4️⃣  Starting services..."
npm run docker:up
sleep 10

# Step 5: Health check
echo ""
echo "5️⃣  Verifying health..."
if curl -s http://localhost:3000/health/ready | grep -q "ready"; then
  echo "   ✅ Server is healthy"
else
  echo "   ⚠️  Server may still be starting (wait 5-10 seconds and try manually)"
fi

echo ""
echo "✨ Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Get a JWT token: curl -X POST http://localhost:3000/auth/token ..."
echo "2. Test the fix: curl -X POST http://localhost:3000/ai/chat/message ..."
echo "3. See FIX_ANALYTICS_RESPONSE.md for test cases"
echo ""
