/**
 * Vision Model Integration for CAPTCHA Solving
 * 
 * Uses Gemini 2.5 Flash to analyze CAPTCHA images and audio
 */

import { logger } from "../../../utils/logger.ts";
import { CAPTCHA_PROMPTS, type CaptchaType, type VisionResponse } from './types';

const log = logger.child("captcha-vision");

interface GeminiConfig {
  apiKey: string;
  model: string;
}

export class CaptchaVision {
  private config: GeminiConfig;
  
  constructor(apiKey: string, model: string = 'gemini-2.0-flash-exp') {
    this.config = { apiKey, model };
  }

  async solveTextCaptcha(imageBase64: string): Promise<VisionResponse> {
    log.info("Solving text CAPTCHA with Gemini Vision");
    
    try {
      const response = await this.callGeminiWithImage(
        imageBase64,
        CAPTCHA_PROMPTS.textSimple
      );
      
      const text = this.extractTextResponse(response);
      log.info(`Text CAPTCHA solved: ${text}`);
      
      return { text };
    } catch (error) {
      log.error(`Text CAPTCHA solving failed: ${(error as Error).message}`);
      return { error: (error as Error).message };
    }
  }

  async solveGridCaptcha(
    imageBase64: string, 
    challengeType: CaptchaType,
    instruction?: string
  ): Promise<VisionResponse> {
    log.info(`Solving ${challengeType} grid CAPTCHA with Gemini Vision`);
    
    const prompt = this.getGridPrompt(challengeType, instruction);
    
    try {
      const response = await this.callGeminiWithImage(imageBase64, prompt);
      const cells = this.extractCellsResponse(response);
      
      log.info(`Grid CAPTCHA solved, cells: ${cells?.join(',') || 'none'}`);
      
      return { cells };
    } catch (error) {
      log.error(`Grid CAPTCHA solving failed: ${(error as Error).message}`);
      return { error: (error as Error).message };
    }
  }

  async solveAudioCaptcha(audioBase64: string): Promise<VisionResponse> {
    log.info("Solving audio CAPTCHA with Gemini Vision");
    
    try {
      const response = await this.callGeminiWithAudio(
        audioBase64,
        CAPTCHA_PROMPTS.audioCaptcha
      );
      
      const text = this.extractTextResponse(response);
      log.info(`Audio CAPTCHA solved: ${text}`);
      
      return { text };
    } catch (error) {
      log.error(`Audio CAPTCHA solving failed: ${(error as Error).message}`);
      return { error: (error as Error).message };
    }
  }

  private getGridPrompt(type: CaptchaType, instruction?: string): string {
    switch (type) {
      case 'recaptcha-v2-grid':
      case 'recaptcha-v2-audio':
        return instruction 
          ? `${CAPTCHA_PROMPTS.recaptchaGrid}\n\nInstrucción específica: ${instruction}`
          : CAPTCHA_PROMPTS.recaptchaGrid;
      case 'hcaptcha':
        return instruction
          ? `${CAPTCHA_PROMPTS.hcaptcha}\n\nInstrucción específica: ${instruction}`
          : CAPTCHA_PROMPTS.hcaptcha;
      default:
        return CAPTCHA_PROMPTS.recaptchaGrid;
    }
  }

  private async callGeminiWithImage(
    imageBase64: string,
    prompt: string
  ): Promise<any> {
    const { GoogleGenAI } = await import('@google/genai');
    
    const ai = new GoogleGenAI({ apiKey: this.config.apiKey });
    
    const contents = [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'image/png',
              data: imageBase64,
            },
          },
        ],
      },
    ];

    const result = await ai.models.generateContent({
      model: this.config.model,
      contents,
    });

    return result;
  }

  private async callGeminiWithAudio(
    audioBase64: string,
    prompt: string
  ): Promise<any> {
    const { GoogleGenAI } = await import('@google/genai');
    
    const ai = new GoogleGenAI({ apiKey: this.config.apiKey });
    
    const contents = [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'audio/mp3',
              data: audioBase64,
            },
          },
        ],
      },
    ];

    const result = await ai.models.generateContent({
      model: this.config.model,
      contents,
    });

    return result;
  }

  private extractTextResponse(response: any): string {
    try {
      const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('No text response from Gemini');
      }
      return text.trim();
    } catch (error) {
      log.error(`Failed to extract text: ${(error as Error).message}`);
      return '';
    }
  }

  private extractCellsResponse(response: any): number[] | null {
    try {
      const text = this.extractTextResponse(response);
      
      if (!text || text.toLowerCase() === 'ninguna' || text.toLowerCase() === 'none') {
        return [];
      }

      const numbers: number[] = [];
      const regex = /\d+/g;
      const matches = text.match(regex);
      
      if (matches) {
        for (const match of matches) {
          const num = parseInt(match, 10);
          if (num >= 1 && num <= 16) {
            numbers.push(num);
          }
        }
      }

      return numbers.length > 0 ? [...new Set(numbers)].sort((a, b) => a - b) : null;
    } catch (error) {
      log.error(`Failed to extract cells: ${(error as Error).message}`);
      return null;
    }
  }
}

export async function createVisionClient(
  apiKey: string,
  model?: string
): Promise<CaptchaVision> {
  return new CaptchaVision(apiKey, model);
}
