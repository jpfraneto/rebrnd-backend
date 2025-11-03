# Admin Contract Upload Implementation

## Overview
This implementation provides admin endpoints to upload all existing brands from the database to the StoriesInMotionV3 smart contract using viem for blockchain interactions.

## New Admin Endpoints

### 1. Contract Status Check
```
GET /admin-service/brands/contract-status
```
**Purpose:** Check sync status between database and contract
**Response:**
```json
{
  "database": { "totalBrands": 150 },
  "contract": { "totalBrands": 0, "nextBrandId": 1 },
  "sync": { "needsUpload": true, "difference": 150 },
  "message": "150 brands need to be uploaded to contract"
}
```

### 2. Upload Preview (Dry Run)
```
GET /admin-service/brands/upload-preview
```
**Purpose:** Preview what would happen during upload without executing
**Response:**
```json
{
  "preview": {
    "totalBrands": 150,
    "totalBatches": 8,
    "batchSize": 20,
    "sampleBrands": [
      {
        "handle": "base",
        "fid": 10001,
        "walletAddress": "0x0000000000000000000000000000000000000000",
        "hasMetadata": true
      }
    ],
    "validation": { "valid": true, "issues": [] }
  }
}
```

### 3. Upload Brands to Contract
```
POST /admin-service/brands/upload-to-contract
```
**Purpose:** Execute the actual upload to smart contract
**Response:**
```json
{
  "success": true,
  "message": "Upload completed: 150/150 brands uploaded successfully",
  "summary": {
    "totalBrands": 150,
    "batchesProcessed": 8,
    "successfulBrands": 150,
    "failedBrands": 0,
    "gasUsed": 2450000,
    "transactionHashes": ["0xabc123...", "0xdef456..."]
  }
}
```

## Environment Variables Required

Add these to your `.env` file:

```env
# V3 Contract Configuration
STORIES_IN_MOTION_V3_ADDRESS=0x... # Your deployed V3 contract address
ADMIN_PRIVATE_KEY=0x...            # Private key for admin wallet (contract owner)

# These should already exist
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/your-api-key
```

## Data Transformation

The system automatically transforms your existing brand data:

- **Handle:** Uses `onChainHandle` if available, otherwise generates from `name`
- **Metadata Hash:** Uses existing `metadataHash` or generates one
- **FID:** Uses `onChainFid` if available, otherwise generates placeholder starting at 10000
- **Wallet Address:** Uses existing `walletAddress` or defaults to zero address

## Safety Features

✅ **Admin-only access** - Only authorized admin FIDs can use these endpoints  
✅ **Data validation** - Validates handles, FIDs, addresses before upload  
✅ **Batch processing** - Uploads in batches of 20 to avoid gas limits  
✅ **Error handling** - Continues if one batch fails, reports all errors  
✅ **Gas estimation** - Estimates gas before each batch  
✅ **Progress tracking** - Detailed logging and results  

## Usage Workflow

1. **Check Status First:**
   ```bash
   curl -X GET "http://localhost:3000/admin-service/brands/contract-status" \
     -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
   ```

2. **Preview Upload:**
   ```bash
   curl -X GET "http://localhost:3000/admin-service/brands/upload-preview" \
     -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
   ```

3. **Execute Upload:**
   ```bash
   curl -X POST "http://localhost:3000/admin-service/brands/upload-to-contract" \
     -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
     -H "Content-Type: application/json"
   ```

## Error Handling

- **Validation Errors:** Returns 400 with specific validation issues
- **Contract Errors:** Continues with next batch, reports failed batches
- **Network Errors:** Retries are handled by viem automatically
- **Permission Errors:** Returns 403 for non-admin users

## Technical Implementation

- **Blockchain Library:** viem v2.38.0 (instead of ethers.js)
- **Batch Size:** 20 brands per transaction
- **Gas Buffer:** 20% added to gas estimates
- **Delay Between Batches:** 3 seconds to avoid rate limiting
- **Contract ABI:** Embedded in the service
- **Database:** TypeORM with existing Brand model

## Admin FIDs

Currently authorized admin FIDs:
- 5431
- 16098

Update `adminFids` array in `admin.controller.ts` to modify access.

## Monitoring

All operations are logged with emojis for easy tracking:
- 🚀 Upload start
- 🔄 Batch processing  
- ⛽ Gas estimation
- 📤 Transaction sent
- ✅ Success
- ❌ Errors
- 🏁 Completion

Check server logs for detailed progress during upload.