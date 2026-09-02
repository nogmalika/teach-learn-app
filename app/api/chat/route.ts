import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { mode, topic, chatHistory, exchangeCount, lastUserMessage, targetKeywords, coveredKeywords, errorCount } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Gemini API key is not configured." }, { status: 500 });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    // 1. 初期化：必須キーワードの生成
    if (mode === "init") {
      const systemInstruction = `
あなたは教育カリキュラム作成の専門家です。
「${topic}」を深く理解・説明する上で欠かせない必須コア概念・キーワードを4〜5個選定してください。
出力フォーマット（JSONのみ）:
{
  "keywords": ["キーワード1", "キーワード2", "キーワード3", "キーワード4"]
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
      return NextResponse.json({ keywords: parsed.keywords });
    }

    // 2. 通常対話（キーワード判定 + ソクラテス問答 + 先生の段階的ヒント + 自動終了判定）
    if (mode === "chat") {
      const currentErrorLevel = errorCount || 0;

      const systemInstruction = `
あなたは「${topic}」のソクラテス式学習セッションを管理するAIシステムです。

【重要キーワード情報】
・全必須キーワード: ${JSON.stringify(targetKeywords || [])}
・すでにカバーされたキーワード: ${JSON.stringify(coveredKeywords || [])}

【タスク】
1. **キーワード判定**: 直前のユーザー発言で新しく正しく説明されたキーワードがあれば、\`newlyCoveredKeywords\` に入れてください。
2. **全クリア判定**: すでにカバーされたものと今回カバーされたものを合わせて、全必須キーワードが網羅されたか判定してください。全網羅された場合、\`isAllCompleted\` を true にしてください。

【役割と返答ロジック】
- **全網羅時 (\`isAllCompleted: true\`) の場合**:
  - role: "student"
  - questionType: "理解完了"
  - reply: 「完璧に理解できました！〇〇先生、とても分かりやすく教えてくださりありがとうございました！」と感謝してセッションを締めくくる言葉を述べてください。新たな質問はしないでください。

- **全網羅前の場合**:
  1. **先生AI (teacher) の介入条件**:
     - ユーザーの発言に【明らかな事実・科学的誤り】や【重大な誤解】がある場合。
     - 「わからない」「ギブ」「教えて」などと困っている場合。
     ➡️ 介入深度: ${currentErrorLevel + 1}
        - レベル1: 気づきを促す最小限のヒント。
        - レベル2: 誘導的な質問。
        - レベル3以上: 正しいメカニズムを端的に解説し、生徒役への再説明を促す。
  2. **生徒bot (student) の応答条件**:
     - ユーザーの説明が筋の通っている場合。
     - 以下の問いの型から文脈に最適なものを1つ選び、2〜3文で問い返してください（先回り知識の披露は厳禁）。
       - 定義・明確化 / 前提の検証 / メカニズムの探求 / 反例の吟味 / 影響・境界の推論

【出力フォーマット（JSONのみ）】:
{
  "role": "teacher" または "student",
  "questionType": "定義・明確化" | "前提の検証" | "メカニズムの探求" | "反例の吟味" | "影響・境界の推論" | "先生のヒント" | "理解完了",
  "reply": "発言内容",
  "newlyCoveredKeywords": ["言及されたキーワード"],
  "isAllCompleted": boolean
}
`;

      const contents = [
        {
          role: "user",
          parts: [
            {
              text: `対話ログ:\n${JSON.stringify(chatHistory, null, 2)}\n\n直前のユーザー発言: "${lastUserMessage}"`,
            },
          ],
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
        newlyCoveredKeywords: parsed.newlyCoveredKeywords || [],
        isAllCompleted: Boolean(parsed.isAllCompleted),
      });
    }

    // 3. 採点・講評（QB形式の教科書解説つき）
    if (mode === "review") {
      const systemInstruction = `
あなたは「${topic}」の専門指導医・教育評価AIです。
医師国家試験の過去問集（Question Bank）の解説のように、ユーザーの回答へのフィードバックに加えて、試験対策・学術理解に直結する教科書的ハイライト解説（High-Yield 解説）を生成してください。

全必須キーワード: ${JSON.stringify(targetKeywords || [])}
カバー済みキーワード: ${JSON.stringify(coveredKeywords || [])}

出力フォーマット（JSONのみ）:
{
  "totalScore": 85,
  "accuracyScore": 35,
  "coverageScore": 25,
  "clarityScore": 25,
  "goodPoints": ["〜の論理展開が明瞭だった"],
  "improvementPoints": ["〜に関する言及が薄かった"],
  "generalFeedback": "全体としての講評",
  "textbookSummary": {
    "coreConcept": "【基本概念・病態生理/概要】についての簡潔で本質的な解説（2〜3行）",
    "keyMechanisms": ["要点1: 機構やポイント", "要点2: 機構やポイント", "要点3: 機構やポイント"],
    "clinicalSignificance": "【臨床的意義 / 重要ポイント（国試・実務の要点）】についての解説"
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

      return NextResponse.json({ reply: data.candidates[0].content.parts[0].text, responderRole: "teacher" });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
