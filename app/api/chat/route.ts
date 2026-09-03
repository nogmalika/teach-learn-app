import { NextResponse } from "next/server";

// Wikimedia Commonsから関連画像を検索する関数
async function fetchWikimediaImage(query: string) {
  try {
    const endpoint = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
      query
    )}&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url|extmetadata&format=json&origin=*`;

    const res = await fetch(endpoint, {
      headers: { "User-Agent": "TeachToLearnApp/1.0 (educational-tutor-app)" },
    });
    const data = await res.json();
    if (!data.query || !data.query.pages) return null;

    const pageKey = Object.keys(data.query.pages)[0];
    const page = data.query.pages[pageKey];
    if (!page.imageinfo || page.imageinfo.length === 0) return null;

    const info = page.imageinfo[0];
    return {
      imageUrl: info.url,
      title: page.title.replace(/^File:/i, "").replace(/\.[^/.]+$/, ""),
      description: info.extmetadata?.ObjectName?.value || info.extmetadata?.ImageDescription?.value || page.title,
    };
  } catch (err) {
    console.error("Wikimedia API error:", err);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { 
      mode, 
      topic, 
      chatHistory, 
      exchangeCount, 
      lastUserMessage, 
      targetCategories, 
      coveredCategories, 
      errorCount 
    } = await req.json();
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Gemini API key is not configured." }, { status: 500 });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

    // 1. 初期化：思考フレームワーク（病態・症状・診断・治療など4つの概念カテゴリ）
    if (mode === "init") {
      const systemInstruction = `
あなたは医学・学術カリキュラムの設計者です。
「${topic}」について、学習者がアウトプットすべき4つの概念カテゴリ（思考フレーム）を設計してください。
※ 医学テーマ: 「病態・メカニズム」「症状・合併症」「診断・検査」「治療・管理」
※ 一般テーマ: 「定義・背景」「構成・メカニズム」「影響・反例」「応用・対策」
判定用の内部キーワード（internalKeywords）を各2〜3個設定してください（学習者には単語を直接見せません）。

出力フォーマット（JSONのみ）:
{
  "categories": [
    { "id": "cat_1", "name": "病態・メカニズム", "internalKeywords": ["主要因", "機序"] },
    { "id": "cat_2", "name": "症状・合併症", "internalKeywords": ["臨床症状", "リスク"] },
    { "id": "cat_3", "name": "診断・検査", "internalKeywords": ["検査法", "所見"] },
    { "id": "cat_4", "name": "治療・管理", "internalKeywords": ["第一選択薬", "対処法"] }
  ]
}
`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: `テーマ: ${topic}` }] }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
      return NextResponse.json({ categories: parsed.categories });
    }

    // 2. 通常対話：カテゴリ判定 + ソクラテス問答 + 先生の介入
    if (mode === "chat") {
      const currentErrorLevel = errorCount || 0;

      const systemInstruction = `
あなたは「${topic}」のソクラテス式学習セッションを管理するAIシステムです。

【思考カテゴリ情報】
全カテゴリ: ${JSON.stringify(targetCategories || [])}
達成済みID: ${JSON.stringify(coveredCategories || [])}

【タスク】
1. 直前のユーザー発言で未達成カテゴリの内容が説明されていれば \`newlyCoveredCategoryIds\` に追加。
2. 4つのカテゴリがすべて網羅されたら \`isAllCompleted: true\`。

【応答方針】
- 全網羅時 (\`isAllCompleted: true\`):
  - role: "student"
  - questionType: "理解完了"
  - reply: 「先生、全体のつながりが非常にクリアに理解できました！丁寧に教えてくださりありがとうございました！」と締めくくる。
- 全網羅前:
  1. 先生AI (teacher) の介入条件:
     - 明白な事実誤認・誤解がある場合、または「わからない」「教えて」「ギブ」等のヘルプ要請時。
     - 介入レベル: ${currentErrorLevel + 1}（Lv.1: 軽い気づきの問いかけ ➔ Lv.2: 誘導ヒント ➔ Lv.3: 端的な解説と再説明の促し）
  2. 生徒bot (student) の応答条件:
     - 説明が妥当なら、ソクラテス式の型（定義・明確化 / 前提の検証 / メカニズムの探求 / 反例・鑑別の吟味 / 影響・境界の推論）から最適なものを1つ選んで2〜3文で質問。

【出力フォーマット（JSONのみ）】:
{
  "role": "teacher" または "student",
  "questionType": "定義・明確化" | "前提の検証" | "メカニズムの探求" | "反例・鑑別の吟味" | "影響・境界の推論" | "先生のヒント" | "理解完了",
  "reply": "発言内容",
  "newlyCoveredCategoryIds": ["cat_1"],
  "isAllCompleted": boolean
}
`;

      const contents = [
        {
          role: "user",
          parts: [{ text: `対話ログ:\n${JSON.stringify(chatHistory, null, 2)}\n\n直前のユーザー発言: "${lastUserMessage}"` }],
        },
      ];

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: contents,
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
      return NextResponse.json({
        reply: parsed.reply,
        responderRole: parsed.role,
        questionType: parsed.questionType || "",
        newlyCoveredCategoryIds: parsed.newlyCoveredCategoryIds || [],
        isAllCompleted: Boolean(parsed.isAllCompleted),
      });
    }

    // 3. 採点・QBスタイル解説・Mermaid病態図・画像検索
    if (mode === "review") {
      const systemInstruction = `
あなたは「${topic}」の指導医・専門評価官です。
QB（Question Bank）形式の解説スタイルで学習者の説明を評価し、洗練された病態解説を作成してください。

【画像検索用クエリ】
Wikimedia Commonsでこのテーマに最も適した学術・医学画像（模式図、病理組織像、内視鏡、解剖図）がヒットする英語検索クエリ（imageSearchQuery）を出力してください。
例:
- 胃潰瘍 ➔ "Gastric ulcer endoscopy"
- 心筋梗塞 ➔ "Myocardial infarction diagram"
- 光合成 ➔ "Photosynthesis light reaction diagram"

【Mermaidダイアグラム】
病態の因果関係・メカニズム（原因 ➔ 変化 ➔ 症状）を表すMermaidフローチャート（\`graph TD\`）を出力してください。

出力フォーマット（JSONのみ）:
{
  "totalScore": 85,
  "accuracyScore": 35,
  "coverageScore": 25,
  "clarityScore": 25,
  "goodPoints": ["〜の説明が正確だった"],
  "improvementPoints": ["〜の言及が不足していた"],
  "generalFeedback": "全体講評",
  "imageSearchQuery": "英語検索クエリ",
  "textbookSummary": {
    "coreConcept": "【基本概念・病態生理】の本質的解説",
    "keyMechanisms": ["機序1の説明", "機序2の説明", "機序3の説明"],
    "clinicalSignificance": "【臨床的意義・国試/実務の急所】",
    "mermaidGraph": "graph TD\\n  A[原因] --> B[機序]\\n  B --> C[結果]"
  }
}
`;
      const historyText = chatHistory
        .map((m: { role: string; content: string }) => `${m.role === "user" ? "【ユーザー】" : "【応答】"}: ${m.content}`)
        .join("\n\n");

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: `対話ログ:\n${historyText}` }] }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      const parsedReview = JSON.parse(data.candidates[0].content.parts[0].text);

      let imageData = null;
      if (parsedReview.imageSearchQuery) {
        imageData = await fetchWikimediaImage(parsedReview.imageSearchQuery);
      }

      if (parsedReview.textbookSummary && imageData) {
        parsedReview.textbookSummary.image = imageData;
      }

      return NextResponse.json({ 
        reply: JSON.stringify(parsedReview), 
        responderRole: "teacher" 
      });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
