import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createWalletClient, createPublicClient, http, encodeAbiParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

import { User } from '../../../models';
import { getConfig } from '../../../security/config';
import { logger } from '../../../main';

@Injectable()
export class SignatureService {
  private readonly CONTRACT_ADDRESS =
    process.env.STORIES_IN_MOTION_V5_ADDRESS ||
    '0x570b1138AFc0F40B990792FA134005e32a9f0503';
  private readonly DOMAIN_NAME = 'StoriesInMotionV5';
  private readonly DOMAIN_VERSION = '1';
  private readonly CHAIN_ID = 8453; // Base mainnet

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async generateAuthorizationSignature(
    fid: number,
    walletAddress: string,
    deadline: number,
  ): Promise<string> {
    logger.log(
      `🔐 [SIGNATURE] Generating authorization signature for FID: ${fid}, Wallet: ${walletAddress}`,
    );

    const config = getConfig();

    if (!process.env.PRIVATE_KEY) {
      logger.error(
        `❌ [SIGNATURE] PRIVATE_KEY environment variable is not set`,
      );
      throw new Error('PRIVATE_KEY environment variable is not set');
    }

    logger.log(`✅ [SIGNATURE] Backend private key found`);

    const privateKey = process.env.PRIVATE_KEY.startsWith('0x')
      ? (process.env.PRIVATE_KEY as `0x${string}`)
      : (`0x${process.env.PRIVATE_KEY}` as `0x${string}`);

    const account = privateKeyToAccount(privateKey);
    logger.log(
      `🔐 [SIGNATURE] Created account from private key: ${account.address}`,
    );

    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(),
    });

    const domain = {
      name: this.DOMAIN_NAME,
      version: this.DOMAIN_VERSION,
      chainId: this.CHAIN_ID,
      verifyingContract: this.CONTRACT_ADDRESS as `0x${string}`,
    } as const;

    logger.log(`🔐 [SIGNATURE] EIP-712 domain configured:`);
    logger.log(`   - Name: ${domain.name}`);
    logger.log(`   - Version: ${domain.version}`);
    logger.log(`   - Chain ID: ${domain.chainId}`);
    logger.log(`   - Contract: ${domain.verifyingContract}`);

    const types = {
      Authorization: [
        { name: 'fid', type: 'uint256' },
        { name: 'wallet', type: 'address' },
        { name: 'deadline', type: 'uint256' },
      ],
    } as const;

    logger.log(`🔐 [SIGNATURE] Signing authorization message with:`);
    logger.log(`   - FID: ${fid}`);
    logger.log(`   - Wallet: ${walletAddress}`);
    logger.log(`   - Deadline: ${deadline}`);

    const signature = await walletClient.signTypedData({
      account,
      domain,
      types,
      primaryType: 'Authorization',
      message: {
        fid: BigInt(fid),
        wallet: walletAddress as `0x${string}`,
        deadline: BigInt(deadline),
      },
    });

    logger.log(
      `✅ [SIGNATURE] Authorization signature generated: ${signature}`,
    );

    const authData = encodeAbiParameters(
      [
        { name: 'fid', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'signature', type: 'bytes' },
      ],
      [BigInt(fid), BigInt(deadline), signature],
    );

    logger.log(`✅ [SIGNATURE] Auth data encoded: ${authData}`);

    return authData;
  }

  async generateLevelUpSignature(
    fid: number,
    newLevel: number,
    deadline: number,
    walletAddress: string,
  ): Promise<string> {
    logger.log(
      `📈 [SIGNATURE] Generating level up signature for FID: ${fid}, Level: ${newLevel}, Wallet: ${walletAddress}`,
    );

    if (!process.env.PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY environment variable is not set');
    }

    const user = await this.userRepository.findOne({ where: { fid } });
    if (!user) {
      throw new Error('User not found');
    }

    if (!walletAddress) {
      throw new Error('Wallet address is required');
    }

    const privateKey = process.env.PRIVATE_KEY.startsWith('0x')
      ? (process.env.PRIVATE_KEY as `0x${string}`)
      : (`0x${process.env.PRIVATE_KEY}` as `0x${string}`);

    const account = privateKeyToAccount(privateKey);
    
    // Create a public client to read from the contract
    const publicClient = createPublicClient({
      chain: base,
      transport: http(),
    });

    // Define the fidNonces ABI fragment
    const fidNoncesAbi = [
      {
        inputs: [
          { name: 'fid', type: 'uint256' },
          { name: 'wallet', type: 'address' }
        ],
        name: 'fidNonces',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
      },
    ] as const;

    // Read the current nonce from the contract for this FID and wallet
    const nonce = await publicClient.readContract({
      address: this.CONTRACT_ADDRESS as `0x${string}`,
      abi: fidNoncesAbi,
      functionName: 'fidNonces',
      args: [BigInt(fid), walletAddress as `0x${string}`],
    } as any);

    logger.log(`📈 [SIGNATURE] Current nonce from contract: ${nonce}`);

    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(),
    });

    const domain = {
      name: this.DOMAIN_NAME,
      version: this.DOMAIN_VERSION,
      chainId: this.CHAIN_ID,
      verifyingContract: this.CONTRACT_ADDRESS as `0x${string}`,
    } as const;

    const types = {
      LevelUp: [
        { name: 'fid', type: 'uint256' },
        { name: 'newLevel', type: 'uint8' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    } as const;

    logger.log(`📈 [SIGNATURE] Signing level up message with:`);
    logger.log(`   - FID: ${fid}`);
    logger.log(`   - New Level: ${newLevel}`);
    logger.log(`   - Nonce: ${nonce}`);
    logger.log(`   - Deadline: ${deadline}`);
    logger.log(`   - Wallet: ${walletAddress}`);

    const signature = await walletClient.signTypedData({
      account,
      domain,
      types,
      primaryType: 'LevelUp',
      message: {
        fid: BigInt(fid),
        newLevel: newLevel,
        nonce: BigInt(nonce as bigint),
        deadline: BigInt(deadline),
      },
    });

    logger.log(`✅ [SIGNATURE] Level up signature generated: ${signature}`);

    return signature;
  }

  async generateRewardClaimSignature(
    recipient: string,
    fid: number,
    amount: string,
    day: number,
    castHash: string,
    deadline: number,
  ): Promise<{ signature: string; nonce: number }> {
    logger.log(
      `💰 [SIGNATURE] Generating reward claim signature for FID: ${fid}, Amount: ${amount}`,
    );

    if (!process.env.PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY environment variable is not set');
    }

    const user = await this.userRepository.findOne({ where: { fid } });
    if (!user) {
      throw new Error('User not found');
    }

    const privateKey = process.env.PRIVATE_KEY.startsWith('0x')
      ? (process.env.PRIVATE_KEY as `0x${string}`)
      : (`0x${process.env.PRIVATE_KEY}` as `0x${string}`);

    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(),
    });

    const domain = {
      name: this.DOMAIN_NAME,
      version: this.DOMAIN_VERSION,
      chainId: this.CHAIN_ID,
      verifyingContract: this.CONTRACT_ADDRESS as `0x${string}`,
    } as const;

    const types = {
      RewardClaim: [
        { name: 'recipient', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'fid', type: 'uint256' },
        { name: 'day', type: 'uint256' },
        { name: 'castHash', type: 'string' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    } as const;

    const nonce = Date.now();

    logger.log(`💰 [SIGNATURE] Signing reward claim message with:`);
    logger.log(`   - Recipient: ${recipient}`);
    logger.log(`   - Amount: ${amount}`);
    logger.log(`   - FID: ${fid}`);
    logger.log(`   - Day: ${day}`);
    logger.log(`   - Cast Hash: ${castHash}`);
    logger.log(`   - Nonce: ${nonce}`);
    logger.log(`   - Deadline: ${deadline}`);

    const signature = await walletClient.signTypedData({
      account,
      domain,
      types,
      primaryType: 'RewardClaim',
      message: {
        recipient: recipient as `0x${string}`,
        amount: BigInt(amount),
        fid: BigInt(fid),
        day: BigInt(day),
        castHash: castHash,
        nonce: BigInt(nonce),
        deadline: BigInt(deadline),
      },
    });

    logger.log(`✅ [SIGNATURE] Reward claim signature generated: ${signature}`);

    return { signature, nonce };
  }
}
