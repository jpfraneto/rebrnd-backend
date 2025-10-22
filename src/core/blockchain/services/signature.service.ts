import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createWalletClient, http, encodeAbiParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

import { User } from '../../../models';
import { getConfig } from '../../../security/config';
import { logger } from '../../../main';

@Injectable()
export class SignatureService {
  private readonly CONTRACT_ADDRESS = '0xAf5806B62EC2dB8519BfE408cF521023Bc5C7e61';
  private readonly DOMAIN_NAME = 'StoriesInMotionV1';
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
      logger.error(`❌ [SIGNATURE] PRIVATE_KEY environment variable is not set`);
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

    logger.log(`✅ [SIGNATURE] Authorization signature generated: ${signature}`);

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
  ): Promise<string> {
    logger.log(
      `📈 [SIGNATURE] Generating level up signature for FID: ${fid}, Level: ${newLevel}`,
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
      LevelUp: [
        { name: 'fid', type: 'uint256' },
        { name: 'newLevel', type: 'uint8' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    } as const;

    const nonce = Date.now();

    logger.log(`📈 [SIGNATURE] Signing level up message with:`);
    logger.log(`   - FID: ${fid}`);
    logger.log(`   - New Level: ${newLevel}`);
    logger.log(`   - Nonce: ${nonce}`);
    logger.log(`   - Deadline: ${deadline}`);

    const signature = await walletClient.signTypedData({
      account,
      domain,
      types,
      primaryType: 'LevelUp',
      message: {
        fid: BigInt(fid),
        newLevel: newLevel,
        nonce: BigInt(nonce),
        deadline: BigInt(deadline),
      },
    });

    logger.log(`✅ [SIGNATURE] Level up signature generated: ${signature}`);

    return signature;
  }

  async generateRewardClaimSignature(
    fid: number,
    amount: string,
    day: number,
    deadline: number,
  ): Promise<string> {
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
      ClaimReward: [
        { name: 'user', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'fid', type: 'uint256' },
        { name: 'day', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    } as const;

    const nonce = Date.now();

    logger.log(`💰 [SIGNATURE] Signing reward claim message with:`);
    logger.log(`   - User: ${account.address}`);
    logger.log(`   - Amount: ${amount}`);
    logger.log(`   - FID: ${fid}`);
    logger.log(`   - Day: ${day}`);
    logger.log(`   - Nonce: ${nonce}`);
    logger.log(`   - Deadline: ${deadline}`);

    const signature = await walletClient.signTypedData({
      account,
      domain,
      types,
      primaryType: 'ClaimReward',
      message: {
        user: account.address,
        amount: BigInt(amount),
        fid: BigInt(fid),
        day: BigInt(day),
        nonce: BigInt(nonce),
        deadline: BigInt(deadline),
      },
    });

    logger.log(`✅ [SIGNATURE] Reward claim signature generated: ${signature}`);

    return signature;
  }
}