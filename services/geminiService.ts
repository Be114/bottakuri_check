import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisReport } from "../types";

// Initialize the client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Step 1: Gather information using Flash with Grounding (Maps + Search)
 */
export async function gatherPlaceData(query: string, userLocation?: { lat: number; lng: number }): Promise<{ rawText: string; groundingChunks: any[] }> {
  const model = "gemini-2.5-flash";
  
  const prompt = `
    ユーザーが次の場所について調べています: "${query}"。
    
    以下のタスクを実行してください:
    1. Google Mapsツールを使用して、この場所の正確なGoogle評価、クチコミ件数、住所、および最近のクチコミの要約を取得してください。
    2. Google Searchツールを使用して、「食べログ」や「Retty」などの他の信頼できる日本のレビューサイトでのこの場所の評価を検索してください。
    3. 検索結果から、Googleの評価と他のプラットフォームの評価の乖離（かいり）に注目してください。
    4. 「サクラ」「やらせ」「高評価依頼」「LINE登録で無料」などの疑わしい活動に関する言及がないか探してください。

    すべての情報を詳細なレポートとしてまとめてください。
  `;

  const retrievalConfig: any = {};
  if (userLocation) {
    retrievalConfig.latLng = {
      latitude: userLocation.lat,
      longitude: userLocation.lng,
    };
  }

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }, { googleMaps: {} }],
        toolConfig: {
          retrievalConfig: Object.keys(retrievalConfig).length > 0 ? retrievalConfig : undefined
        }
      },
    });

    const rawText = response.text || "情報が見つかりませんでした。";
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    return { rawText, groundingChunks };
  } catch (error) {
    console.error("Error in gatherPlaceData:", error);
    throw new Error("情報の取得に失敗しました。");
  }
}

/**
 * Step 2: Analyze the gathered data using Pro with Thinking Mode
 */
export async function analyzeReviewData(contextText: string): Promise<AnalysisReport> {
  const model = "gemini-3-pro-preview";

  const prompt = `
    あなたはGoogleマップのレビュー分析の専門家であり、通称「ぼったくりチェッカー」です。
    以下の収集された情報を分析し、この場所のレビューが「サクラ（偽物）」である可能性や「ぼったくり（危険な店）」である可能性を判定してください。

    ### 分析対象データ
    ${contextText}

    ### 判定基準
    1. **評価の乖離**: Googleの評価が4.0以上で、食べログなどの他サイトが3.2未満の場合、リスク大。
    2. **レビュー分布**: ★5と★1に極端に偏っている（F型分布）は危険。
    3. **キーワード**: 「最高」「親切」「感動」などの抽象的な絶賛ばかり、または「詐欺」「ぼったくり」「キャッチ」などの警告があるか。
    4. **投稿者**: アカウント名が不自然、投稿数が1件のみのアカウントが多いなど（テキスト情報から推測できる場合）。

    ### 出力要件
    以下のJSONスキーマに従って結果を出力してください。
    - sakuraScore: 0(安全)〜100(危険)の整数。これは「ぼったくり危険度」として表示されます。
    - estimatedRealRating: サクラを除外したと仮定した場合の真の実力値（推定）。
    - reviewDistribution: ★5〜★1の分布（テキストから推測できない場合は、危険度度合いに応じてそれらしい分布を推定してください）。

    JSONのみを出力してください。Markdownコードブロックは不要です。
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 32768 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            placeName: { type: Type.STRING },
            address: { type: Type.STRING },
            sakuraScore: { type: Type.INTEGER, description: "0 to 100 score indicating likelihood of fake reviews/rip-off risk" },
            estimatedRealRating: { type: Type.NUMBER },
            googleRating: { type: Type.NUMBER },
            tabelogRating: { type: Type.NUMBER, nullable: true },
            verdict: { type: Type.STRING, enum: ["安全", "注意", "危険"] },
            risks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING },
                  riskLevel: { type: Type.STRING, enum: ["low", "medium", "high"] },
                  description: { type: Type.STRING }
                }
              }
            },
            suspiciousKeywordsFound: { type: Type.ARRAY, items: { type: Type.STRING } },
            summary: { type: Type.STRING },
            reviewDistribution: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  star: { type: Type.INTEGER },
                  percentage: { type: Type.INTEGER }
                }
              }
            }
          },
          required: ["placeName", "sakuraScore", "verdict", "risks"]
        }
      }
    });

    const jsonText = response.text || "{}";
    return JSON.parse(jsonText) as AnalysisReport;
  } catch (error) {
    console.error("Error in analyzeReviewData:", error);
    throw new Error("分析に失敗しました。");
  }
}