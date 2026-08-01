# Install dependencies
Write-Host "Installing dependencies..."
npm install

# Build with analyzer
Write-Host "Building with bundle analyzer..."
`$env:ANALYZE='true'
npx next build

Write-Host "Build completed successfully!"