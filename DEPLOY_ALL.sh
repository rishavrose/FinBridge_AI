#!/bin/bash

# All-in-one deployment script
# Deploys both AI fix and Tool Runner removal

set -e

echo "🚀 Deploying AI Analytics Fix + Tool Runner Removal"
echo "=================================================="
echo ""

# Step 1: Verify TypeScript
echo "1️⃣  Verifying TypeScript compilation..."
if npm run typecheck > /dev/null 2>&1; then
  echo "   ✅ Backend TypeScript OK"
else
  echo "   ❌ Backend TypeScript has errors!"
  npm run typecheck
  exit 1
fi

# Step 2: Build backend
echo ""
echo "2️⃣  Building backend..."
npm run build > /dev/null
echo "   ✅ Backend built"

# Step 3: Build frontend
echo ""
echo "3️⃣  Building frontend..."
cd frontend
if npm run build > /dev/null 2>&1; then
  echo "   ✅ Frontend built"
else
  echo "   ❌ Frontend build failed!"
  npm run build
  exit 1
fi
cd ..

# Step 4: Stop containers
echo ""
echo "4️⃣  Stopping services..."
npm run docker:down > /dev/null 2>&1
sleep 3
echo "   ✅ Services stopped"

# Step 5: Rebuild Docker image
echo ""
echo "5️⃣  Rebuilding Docker image..."
npm run docker:build > /dev/null 2>&1
echo "   ✅ Docker image rebuilt"

# Step 6: Start containers
echo ""
echo "6️⃣  Starting services..."
npm run docker:up > /dev/null 2>&1
sleep 10
echo "   ✅ Services started"

# Step 7: Health check
echo ""
echo "7️⃣  Verifying health..."
if curl -s http://localhost:3000/health/ready | grep -q "ready"; then
  echo "   ✅ Server is healthy"
else
  echo "   ⚠️  Server may still be starting (wait 5-10 more seconds)"
fi

echo ""
echo "✨ Deployment complete!"
echo ""
echo "═══════════════════════════════════════════════════════"
echo "NEXT: Test your changes"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "1️⃣  Get a token:"
echo '   TOKEN=$(curl -s -X POST http://localhost:3000/auth/token \'
echo '     -H "Content-Type: application/json" \'
echo '     -d '"'"'{"userId":"dev","role":"analyst","secret":"dev_bootstrap"}'"'"' | jq -r .token)'
echo ""
echo "2️⃣  Test AI Analytics (should NOT be placeholder text):"
echo '   curl -s -X POST http://localhost:3000/ai/chat/message \'
echo '     -H "Authorization: Bearer $TOKEN" \'
echo '     -H "Content-Type: application/json" \'
echo '     -d '"'"'{"message": "How many payouts in april with failed status and amount > 100?"}'"'"' | jq .reply'
echo ""
echo "3️⃣  Verify Tool Runner is GONE:"
echo "   - Open http://localhost:3000 in browser"
echo "   - Check sidebar - should NOT see 'Tool Runner' button"
echo ""
echo "═══════════════════════════════════════════════════════"
echo ""
