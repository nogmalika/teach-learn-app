import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { mode, topic, chatHistory, exchangeCount, lastUserMessage, targetKeywords, coveredKeywords, errorCount } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Gemini API key is not configured." }, { status: 500 });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

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

    // 2. 通常対話（キーワード判定 + ソクラテス問答 + 先生の段階的ヒント）
    if (mode === "chat") {
      const currentErrorLevel = errorCount || 0;

      const systemInstruction = `
あなたは「${topic}」のソクラテス式学習セッションを管理するAIシステムです。

【重要キーワード情報】
・全必須キーワード: ${JSON.stringify(targetKeywords || [])}
・すでにカバーされたキーワード: ${JSON.stringify(coveredKeywords || [])}

【役割の判定基準】
1. **先生AI (teacher) の介入条件**:
   - ユーザーの発言に【明らかな科学的・事実的誤り】や【重大な誤解】が含まれている場合。
   - ユーザーが「わからない」「ギブ」「忘れた」などと困っている場合。
   ➡️ 介入深度レベル: ${currentErrorLevel + 1}
      - レベル1（初回）: 答えは言わず、「あれ？〇〇の部分、もう一度思い出してみて？」と気づきを与える最小限の指摘。
      - レベル2（2回目）: 「ヒント: 〇〇に関係する要素は何だったかな？」と具体的な誘導質問。
      - レベル3以上（3回目〜）: 端的に正しいメカニズムを解説し、「これをもとにもう一度生徒に説明してみて！」と促す。

2. **生徒bot (student) の応答条件**:
   - ユーザーの説明が概ね正しい場合。
   ➡️ ソクラテス式問答（Lv.${exchangeCount <= 1 ? "1: 定義" : exchangeCount <= 3 ? "2: 前提・反例" : "3: 応用・境界"}）で2〜3文で問い返してください。先回り知識の披露は厳禁。

【キーワード判定】
直前のユーザー発言で新しく正しく言及・説明されたキーワードがあれば、\`newlyCoveredKeywords\` に抽出してください。

【出力フォーマット】
必ず以下のJSON形式のみを出力してください:
{
  "role": "teacher" または "student",
  "reply": "発言内容",
  "newlyCoveredKeywords": ["言及されたキーワード"]
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
        newlyCoveredKeywords: parsed.newlyCoveredKeywords || [],
      });
    }

    // 3. 採点モード
    if (mode === "review") {
      const systemInstruction = `
あなたは「${topic}」の教育評価AIです。対話ログ全体を客観的に評価してください。
全必須キーワード: ${JSON.stringify(targetKeywords || [])}
カバー済みキーワード: ${JSON.stringify(coveredKeywords || [])}

出力フォーマット（JSONのみ）:
{
  "totalScore": 85,
  "accuracyScore": 35,
  "coverageScore": 25,
  "clarityScore": 25,
  "goodPoints": ["〜の説明が正確だった"],
  "improvementPoints": ["〜の言及が不足していた"],
  "generalFeedback": "全体として〜"
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
