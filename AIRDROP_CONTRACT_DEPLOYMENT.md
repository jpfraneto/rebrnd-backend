# Airdrop Contract Deployment Guide

## Overview

This contract enables FID-based airdrop claiming using Merkle proofs. Users can claim their airdrop tokens by providing their FID, amount, and merkle proof.

## Contract Features

1. **FID-Based Claiming**: Users claim using their Farcaster ID (FID)
2. **Wallet Authorization**: Verifies wallet is authorized for FID via StoriesInMotion contract
3. **Merkle Proof Verification**: Uses OpenZeppelin's MerkleProof library
4. **Double-Claim Prevention**: Tracks claimed FIDs
5. **Admin Controls**: Owner can update merkle root, enable/disable claiming

## Deployment Steps

### 1. Deploy Contract

Deploy with these constructor parameters (no merkle root needed):

```solidity
constructor(
    address _brndToken,        // 0x41Ed0311640A5e489A90940b1c33433501a21B07
    address _escrowWallet,     // Wallet holding airdrop tokens
    address _backendSigner     // Backend signer address (from PRIVATE_KEY)
)
```

**Note:** The contract starts with a zero merkle root. You'll set it after generating the snapshot.

### 2. Generate Airdrop Snapshot

Call the backend endpoint to generate the merkle root:

```bash
GET /admin-service/airdrop-snapshot
```

This returns:
```json
{
  "snapshot": {
    "merkleRoot": "0x...",
    "totalUsers": 1111,
    "totalTokens": "1500000000"
  }
}
```

### 3. Set Merkle Root on Contract

After generating the snapshot, set the merkle root on the contract:

```solidity
airdropContract.updateMerkleRoot(merkleRoot);
```

**Important:** Once someone claims (totalClaimed > 0), the merkle root is locked and cannot be updated anymore. Make sure the snapshot is correct before enabling claims.

### 4. Fund and Approve Escrow Wallet

1. Transfer the total airdrop amount to the escrow wallet:
   - Total tokens: 1,500,000,000 BRND (or sum from snapshot)

2. Approve the airdrop contract to spend tokens from escrow:
   ```solidity
   BRND_TOKEN.approve(AIRDROP_CONTRACT_ADDRESS, TOTAL_AIRDROP_AMOUNT);
   ```
   - The contract uses `transferFrom` to move tokens from escrow to claimers

### 5. Enable Claiming

After deployment and funding:

```solidity
airdropContract.setClaimingEnabled(true);
```

## Contract Addresses

- **BRND Token**: `0x41Ed0311640A5e489A90940b1c33433501a21B07`
- **StoriesInMotionV8**: (Your deployed contract address)
- **Escrow Wallet**: (Address holding airdrop tokens)

## User Claim Flow

1. User connects wallet (must be verified for their FID on Farcaster/Neynar)
2. Frontend calls backend: `POST /airdrop-service/claim-signature` with `{ walletAddress }`
3. Backend:
   - Verifies wallet belongs to FID via Neynar API
   - Generates merkle proof for the FID
   - Generates EIP-712 signature verifying wallet ownership
   - Returns: `{ fid, amount, merkleRoot, proof, signature, deadline }`
4. User calls `claimAirdrop(fid, amount, proof, deadline, signature)` on contract
5. Contract verifies:
   - EIP-712 signature matches backend signer
   - Merkle proof is valid
   - FID hasn't been claimed
   - Signature hasn't expired
6. Tokens transferred from escrow to user

## Backend Integration

### Claim Signature Endpoint

The endpoint is already implemented: `POST /airdrop-service/claim-signature`

**Request:**
```json
{
  "walletAddress": "0x...",
  "snapshotId": 1  // Optional, uses latest if not provided
}
```

**Response:**
```json
{
  "fid": 12345,
  "walletAddress": "0x...",
  "amount": "1500000000",
  "merkleRoot": "0x...",
  "proof": ["0x...", "0x..."],
  "signature": "0x...",
  "deadline": 1234567890,
  "snapshotId": 1
}
```

The backend automatically:
- Verifies wallet belongs to FID via Neynar
- Generates merkle proof
- Generates EIP-712 signature

## Security Considerations

1. **Escrow Wallet**: Should hold exactly the total airdrop amount
2. **Merkle Root**: Can be updated by owner **only before the first claim**. Once `totalClaimed > 0`, the root is permanently locked
3. **Claiming Enabled**: Disabled by default, enable after verification
4. **Emergency Withdraw**: Only for emergencies, owner can withdraw stuck tokens
5. **Root Lock**: The merkle root becomes immutable after the first successful claim to prevent manipulation

## Contract Functions

### Public Functions

- `claimAirdrop(uint256 fid, uint256 amount, bytes32[] proof, uint256 deadline, bytes signature)` - Claim airdrop
- `hasClaimed(uint256 fid)` - Check if FID has claimed
- `getStatus()` - Get contract status

### Owner Functions

- `updateMerkleRoot(bytes32 newRoot)` - Update merkle root
- `setClaimingEnabled(bool enabled)` - Enable/disable claiming
- `setBackendSigner(address newSigner)` - Update backend signer address
- `emergencyWithdraw(address token, uint256 amount)` - Emergency withdraw

## Testing Checklist

- [ ] Deploy contract with correct parameters
- [ ] Fund escrow wallet with exact amount
- [ ] Verify merkle root matches backend snapshot
- [ ] Test claiming with valid proof
- [ ] Test double-claim prevention
- [ ] Test unauthorized wallet rejection
- [ ] Test invalid proof rejection
- [ ] Enable claiming after verification
- [ ] Monitor first few claims

## Example Claim Transaction

```javascript
const airdropContract = new ethers.Contract(
  AIRDROP_CONTRACT_ADDRESS,
  AIRDROP_ABI,
  signer
);

// Get signature and proof from backend
const claimData = await fetch('/airdrop-service/claim-signature', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ walletAddress: signer.address })
}).then(r => r.json());

// Claim
const tx = await airdropContract.claimAirdrop(
  claimData.fid,
  claimData.amount,
  claimData.proof,
  claimData.deadline,
  claimData.signature
);
await tx.wait();
```

## Environment Variables

Add to your `.env` file:

```env
# Airdrop Contract (set after deployment)
AIRDROP_CONTRACT_ADDRESS=0x...  # Deployed airdrop contract address

# Backend Signer (should already exist)
PRIVATE_KEY=0x...  # Backend private key (used for signing)
```

