# Airdrop Frontend Integration Guide

This document describes how to integrate the airdrop claiming functionality into the frontend.

## Contract Address

**Airdrop Contract:** `0x776fA62dc8E6Dd37ec2d90e9d12E22efc462c812` (Base Mainnet)

## Backend Endpoints

### 1. Check Claim Status

**Endpoint:** `GET /airdrop-service/claim-status`

**Authentication:** Required (Farcaster QuickAuth)

**Response:**

```typescript
{
  success: true,
  data: {
    fid: number;
    canClaim: boolean;
    reason: string; // Human-readable reason why they can/cannot claim
    hasClaimed: boolean;
    contractStatus: {
      merkleRootSet: boolean;
      claimingEnabled: boolean;
      totalClaimed: string;
      escrowBalance: string;
      allowance: string;
    };
    eligibility: {
      inSnapshot: boolean;
      amount: string | null; // Amount in wei (as string)
    };
  }
}
```

**Use Case:** Call this endpoint when the user opens the airdrop page to show their eligibility status.

**Possible `reason` values:**

- `"Eligible to claim"` - User can claim
- `"Already claimed"` - User has already claimed
- `"Claiming is not enabled yet"` - Contract owner hasn't enabled claiming
- `"Merkle root not set on contract"` - Snapshot hasn't been set on contract yet
- `"Not eligible for airdrop (not in top 1111 users)"` - User not in snapshot

### 2. Get Claim Signature

**Endpoint:** `POST /airdrop-service/claim-signature`

**Authentication:** Required (Farcaster QuickAuth)

**Request Body:**

```typescript
{
  walletAddress: string; // 0x format, must be verified for the FID on Farcaster
  snapshotId?: number; // Optional, uses latest snapshot if not provided
}
```

**Success Response:**

```typescript
{
  success: true,
  data: {
    fid: number;
    walletAddress: string;
    amount: string; // Amount in wei (as string)
    merkleRoot: string; // Hex string
    proof: string[]; // Array of hex strings
    signature: string; // EIP-712 signature (hex string)
    deadline: number; // Unix timestamp (seconds)
    snapshotId: number;
    contractAddress: string; // "0x776fA62dc8E6Dd37ec2d90e9d12E22efc462c812"
    message: string;
  }
}
```

**Error Responses:**

1. **400 Bad Request - Claiming not enabled:**

```typescript
{
  success: false,
  error: "Claiming is not enabled on the contract yet"
}
```

2. **400 Bad Request - Merkle root not set:**

```typescript
{
  success: false,
  error: "Merkle root is not set on the contract yet. Please wait for the snapshot to be set."
}
```

3. **400 Bad Request - Already claimed:**

```typescript
{
  success: false,
  error: "Airdrop already claimed for this FID"
}
```

4. **400 Bad Request - Wallet not verified:**

```typescript
{
  success: false,
  error: "Wallet address is not verified for this FID on Farcaster. Please verify your wallet address on Farcaster first."
}
```

5. **404 Not Found - Not eligible:**

```typescript
{
  success: false,
  error: "FID not found in airdrop snapshot. You are not eligible for the airdrop."
}
```

## Frontend Flow

### Step 1: Check Eligibility

When the user opens the airdrop page:

```typescript
const checkEligibility = async () => {
  try {
    const response = await fetch('/airdrop-service/claim-status', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userToken}`, // Your auth token
      },
    });

    const result = await response.json();

    if (result.success) {
      const { canClaim, reason, hasClaimed, contractStatus, eligibility } =
        result.data;

      // Show appropriate UI based on status
      if (hasClaimed) {
        // Show "Already Claimed" state
      } else if (!contractStatus.claimingEnabled) {
        // Show "Claiming not enabled yet" message
      } else if (!contractStatus.merkleRootSet) {
        // Show "Airdrop not ready yet" message
      } else if (!eligibility.inSnapshot) {
        // Show "Not eligible" message
      } else if (canClaim) {
        // Show claim button
      }
    }
  } catch (error) {
    console.error('Error checking eligibility:', error);
  }
};
```

### Step 2: Claim Airdrop

When user clicks "Claim" button:

```typescript
const claimAirdrop = async (walletAddress: string) => {
  try {
    // Step 1: Get signature and proof from backend
    const response = await fetch('/airdrop-service/claim-signature', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ walletAddress }),
    });

    const result = await response.json();

    if (!result.success) {
      // Handle error (show error message to user)
      throw new Error(result.error);
    }

    const {
      fid,
      amount,
      merkleRoot,
      proof,
      signature,
      deadline,
      contractAddress,
    } = result.data;

    // Step 2: Call smart contract
    const airdropContract = new ethers.Contract(
      contractAddress,
      AIRDROP_ABI, // Use the ABI provided
      signer, // User's wallet signer
    );

    const tx = await airdropContract.claimAirdrop(
      fid,
      amount,
      proof,
      deadline,
      signature,
    );

    // Step 3: Wait for transaction
    await tx.wait();

    // Step 4: Show success message
    console.log('Airdrop claimed successfully!');
  } catch (error) {
    // Handle error
    if (error.message.includes('not enabled')) {
      // Show "Claiming not enabled" message
    } else if (error.message.includes('not set')) {
      // Show "Airdrop not ready" message
    } else if (error.message.includes('already claimed')) {
      // Show "Already claimed" message
    } else if (error.message.includes('not verified')) {
      // Show "Please verify wallet on Farcaster" message
    } else if (error.message.includes('not eligible')) {
      // Show "Not eligible" message
    } else {
      // Show generic error
    }
  }
};
```

## Edge Cases to Handle

### 1. Merkle Root Not Set

**When:** Contract is deployed but snapshot hasn't been set yet.

**Backend Response:** `canClaim: false, reason: "Merkle root not set on contract"`

**Frontend Action:** Show message like "Airdrop is being prepared. Please check back soon."

### 2. Claiming Not Enabled

**When:** Merkle root is set but contract owner hasn't enabled claiming.

**Backend Response:** `canClaim: false, reason: "Claiming is not enabled yet"`

**Frontend Action:** Show message like "Airdrop claiming will be enabled soon. Please check back later."

### 3. User Not in Snapshot

**When:** User is not in the top 1111 users.

**Backend Response:** `canClaim: false, reason: "Not eligible for airdrop (not in top 1111 users)"`

**Frontend Action:** Show message like "You are not eligible for this airdrop. Only the top 1111 users are eligible."

### 4. Already Claimed

**When:** User has already claimed their airdrop.

**Backend Response:** `canClaim: false, reason: "Already claimed", hasClaimed: true`

**Frontend Action:** Show message like "You have already claimed your airdrop!" with transaction hash if available.

### 5. Wallet Not Verified

**When:** User's wallet is not verified on Farcaster.

**Backend Response:** Error from `/claim-signature` endpoint.

**Frontend Action:** Show message like "Please verify your wallet address on Farcaster before claiming."

### 6. Merkle Root Mismatch

**When:** Snapshot was updated but contract still has old root (shouldn't happen if root is locked).

**Backend Response:** Error from `/claim-signature` endpoint.

**Frontend Action:** Show message like "Airdrop snapshot has been updated. Please refresh and try again."

## Smart Contract ABI

Use the ABI provided by the user for the `claimAirdrop` function:

```typescript
const AIRDROP_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: 'fid', type: 'uint256' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
      { internalType: 'bytes32[]', name: 'proof', type: 'bytes32[]' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
      { internalType: 'bytes', name: 'signature', type: 'bytes' },
    ],
    name: 'claimAirdrop',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // ... other functions
];
```

## Example UI States

### 1. Loading State

```typescript
<div>Checking eligibility...</div>
```

### 2. Eligible State

```typescript
<div>
  <h2>You're eligible for the airdrop!</h2>
  <p>Amount: {formatAmount(eligibility.amount)} BRND</p>
  <button onClick={() => claimAirdrop(userWallet)}>Claim Airdrop</button>
</div>
```

### 3. Not Eligible State

```typescript
<div>
  <h2>Not Eligible</h2>
  <p>{reason}</p>
</div>
```

### 4. Already Claimed State

```typescript
<div>
  <h2>Already Claimed</h2>
  <p>You have already claimed your airdrop.</p>
</div>
```

### 5. Not Ready State

```typescript
<div>
  <h2>Airdrop Not Ready</h2>
  <p>{reason}</p>
  <p>Please check back later.</p>
</div>
```

## Important Notes

1. **Wallet Verification:** The wallet address must be verified on Farcaster for the user's FID. The backend verifies this via Neynar API.

2. **Signature Expiry:** The signature has a 1-hour deadline. If the user doesn't claim within 1 hour, they'll need to request a new signature.

3. **Amount Format:** All amounts are returned as strings in wei. Convert to human-readable format using `ethers.formatEther(amount)`.

4. **Error Handling:** Always check `result.success` before accessing `result.data`. Handle all error cases gracefully.

5. **Transaction Status:** After calling `claimAirdrop`, wait for the transaction to be confirmed before showing success.

6. **Refresh Status:** After a successful claim, refresh the claim status to update the UI.
