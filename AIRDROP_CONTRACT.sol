// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IBRND {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/**
 * @title AirdropClaim
 * @notice FID-based airdrop claim contract using Merkle proofs
 * @dev Users claim airdrop tokens by providing their FID, amount, and merkle proof
 *      The contract verifies that the caller's wallet is authorized for the FID
 *      in the main StoriesInMotion contract
 */
contract AirdropClaim is Ownable {
    using MerkleProof for bytes32[];
    using ECDSA for bytes32;

    // EIP-712 Domain
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant AIRDROP_CLAIM_TYPEHASH =
        keccak256("AirdropClaim(uint256 fid,address wallet,uint256 amount,bytes32 merkleRoot,uint256 deadline)");
    bytes32 private immutable DOMAIN_SEPARATOR;

    IBRND public immutable BRND_TOKEN;
    address public immutable ESCROW_WALLET;
    address public backendSigner;

    bytes32 public merkleRoot;
    bool public claimingEnabled;
    
    // Track claimed FIDs to prevent double claiming
    mapping(uint256 => bool) public fidClaimed;
    
    // Track total claimed amount
    uint256 public totalClaimed;

    event MerkleRootUpdated(bytes32 indexed oldRoot, bytes32 indexed newRoot);
    event ClaimingEnabled(bool enabled);
    event BackendSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event AirdropClaimed(
        uint256 indexed fid,
        address indexed recipient,
        uint256 amount
    );
    event EmergencyWithdraw(address indexed token, uint256 amount);

    error InvalidInput();
    error Unauthorized();
    error Expired();
    error AlreadyClaimed();
    error ClaimingDisabled();
    error InvalidProof();
    error InsufficientBalance();
    error MerkleRootNotSet();

    modifier onlyWhenEnabled() {
        if (!claimingEnabled) revert ClaimingDisabled();
        _;
    }

    /**
     * @param _brndToken Address of the BRND token contract
     * @param _escrowWallet Address holding the airdrop tokens
     * @param _backendSigner Address of the backend signer (for EIP-712 verification)
     */
    constructor(
        address _brndToken,
        address _escrowWallet,
        address _backendSigner
    ) Ownable(msg.sender) {
        if (_brndToken == address(0)) revert InvalidInput();
        if (_escrowWallet == address(0)) revert InvalidInput();
        if (_backendSigner == address(0)) revert InvalidInput();

        BRND_TOKEN = IBRND(_brndToken);
        ESCROW_WALLET = _escrowWallet;
        backendSigner = _backendSigner;
        merkleRoot = bytes32(0); // Start with zero, owner will set it later
        claimingEnabled = false; // Disabled by default, enable after deployment

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256("StoriesInMotionAirdrop1"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /**
     * @notice Claim airdrop tokens for a specific FID
     * @param fid The Farcaster ID
     * @param amount The amount of tokens to claim (must match merkle tree)
     * @param proof The merkle proof for this FID and amount
     * @param deadline Signature expiration deadline
     * @param signature EIP-712 signature from backend verifying wallet belongs to FID
     * @dev Backend verifies wallet ownership via Neynar API and signs the claim
     */
    function claimAirdrop(
        uint256 fid,
        uint256 amount,
        bytes32[] calldata proof,
        uint256 deadline,
        bytes calldata signature
    ) external onlyWhenEnabled {
        if (fid == 0) revert InvalidInput();
        if (amount == 0) revert InvalidInput();
        if (merkleRoot == bytes32(0)) revert MerkleRootNotSet();
        if (block.timestamp > deadline) revert Expired();
        if (fidClaimed[fid]) revert AlreadyClaimed();

        // Verify EIP-712 signature from backend
        // Backend verifies wallet belongs to FID via Neynar before signing
        bytes32 structHash = keccak256(
            abi.encode(
                AIRDROP_CLAIM_TYPEHASH,
                fid,
                msg.sender,
                amount,
                merkleRoot,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address recovered = digest.recover(signature);
        if (recovered != backendSigner) revert Unauthorized();

        // Verify merkle proof
        // Leaf is: keccak256(abi.encodePacked(fid, amount))
        bytes32 leaf = keccak256(abi.encodePacked(fid, amount));
        if (!proof.verify(merkleRoot, leaf)) {
            revert InvalidProof();
        }

        // Mark as claimed
        fidClaimed[fid] = true;
        totalClaimed += amount;

        // Transfer tokens from escrow wallet to claimer
        // Note: Escrow wallet must approve this contract first
        if (!BRND_TOKEN.transferFrom(ESCROW_WALLET, msg.sender, amount)) {
            revert InsufficientBalance();
        }

        emit AirdropClaimed(fid, msg.sender, amount);
    }

    /**
     * @notice Check if a FID has already claimed their airdrop
     * @param fid The Farcaster ID to check
     * @return claimed Whether the FID has claimed
     * @return amount The amount they can claim (requires merkle proof to verify)
     */
    function hasClaimed(uint256 fid) external view returns (bool claimed) {
        return fidClaimed[fid];
    }

    /**
     * @notice Update the backend signer address (only owner)
     * @param newSigner The new backend signer address
     */
    function setBackendSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert InvalidInput();
        address oldSigner = backendSigner;
        backendSigner = newSigner;
        emit BackendSignerUpdated(oldSigner, newSigner);
    }

    /**
     * @notice Update the merkle root (only owner)
     * @param newRoot The new merkle root
     * @dev This allows updating the airdrop snapshot without redeploying
     * @dev Once someone has claimed (totalClaimed > 0), the root is locked and cannot be updated
     */
    function updateMerkleRoot(bytes32 newRoot) external onlyOwner {
        if (newRoot == bytes32(0)) revert InvalidInput();
        if (totalClaimed > 0) revert AlreadyClaimed(); // Lock root once claims start
        bytes32 oldRoot = merkleRoot;
        merkleRoot = newRoot;
        emit MerkleRootUpdated(oldRoot, newRoot);
    }

    /**
     * @notice Enable or disable claiming (only owner)
     * @param enabled Whether claiming should be enabled
     */
    function setClaimingEnabled(bool enabled) external onlyOwner {
        claimingEnabled = enabled;
        emit ClaimingEnabled(enabled);
    }

    /**
     * @notice Emergency withdraw function (only owner)
     * @param token Address of the token to withdraw (0x0 for ETH)
     * @param amount Amount to withdraw (0 for all)
     * @dev This should only be used in emergencies
     */
    function emergencyWithdraw(
        address token,
        uint256 amount
    ) external onlyOwner {
        if (token == address(BRND_TOKEN)) {
            uint256 balance = BRND_TOKEN.balanceOf(address(this));
            uint256 withdrawAmount = amount == 0 ? balance : amount;
            if (withdrawAmount > balance) revert InsufficientBalance();
            BRND_TOKEN.transfer(owner(), withdrawAmount);
            emit EmergencyWithdraw(token, withdrawAmount);
        } else {
            revert InvalidInput();
        }
    }

    /**
     * @notice Get contract status
     * @return root Current merkle root
     * @return enabled Whether claiming is enabled
     * @return totalClaimedAmount Total amount claimed so far
     * @return escrowBalance Current balance in escrow wallet
     * @return allowance Amount approved by escrow wallet for this contract
     */
    function getStatus()
        external
        view
        returns (
            bytes32 root,
            bool enabled,
            uint256 totalClaimedAmount,
            uint256 escrowBalance,
            uint256 allowance
        )
    {
        return (
            merkleRoot,
            claimingEnabled,
            totalClaimed,
            BRND_TOKEN.balanceOf(ESCROW_WALLET),
            BRND_TOKEN.allowance(ESCROW_WALLET, address(this))
        );
    }
}

