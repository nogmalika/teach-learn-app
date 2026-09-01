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

    // 2. 通常対話（体系化されたソクラテス式問答 + 段階的先生ヒント + キーワード判定）
    if (mode === "chat") {
      const currentErrorLevel = errorCount || 0;

      const systemInstruction = `
あなたは「${topic}」の体系化されたソクラテス式学習セッションを管理するAIシステムです。

【重要キーワード情報】
・全必須キーワード: ${JSON.stringify(targetKeywords || [])}
・すでにカバーされたキーワード: ${JSON.stringify(coveredKeywords || [])}

【役割の判定基準】
1. **先生AI (teacher) の介入条件**:
   - ユーザーの発言に【明らかな科学的・事実的誤り】や【重大な誤解】が含まれている場合。
   - ユーザーが「わからない」「ギブ」「忘れた」などと困っている場合。
   ➡️ 介入深度レベル: ${currentErrorLevel + 1}
      - レベル1（初回）: 答えは直接言わず、違和感の箇所に気づかせる最小限のヒント。
      - レベル2（2回目）: 関連する構成要素やメカニズムを思い出すための誘導質問。
      - レベル3以上（3回目〜）: 端的に正しい解説を行い、生徒役にもう一度説明してみるよう促す。

2. **生徒bot (student) の応答条件（ソクラテス式問答体系）**:
   ユーザーの説明が筋の通ったものである場合、以下の【5つの問いの型】から対話の文脈やターン数に最適な1つを選択して質問してください（2〜3文）。
   ※ ユーザーがまだ説明していない未知の専門知識を勝手に先回りして披露することは厳禁です。

   【ソクラテス式・問いの型カタログ】
   - [型A: 定義・明確化] (序盤推奨): 概念の本質や日常への例えを深掘りする（例:「それって具体的にどういうことですか？」「日常の何に似ていますか？」）
   - [型B: 前提・仮定の検証]: その説明の前提条件を問う（例:「その現象が成り立つには、どんな前提が必要なんですか？」）
   - [型C: メカニズム・プロセスの探求]: 中間の仕組み・因果関係を問う（例:「なぜその結果につながるのですか？途中の仕組みはどう動くのですか？」）
   - [型D: 視点・反例の吟味]: 反例や別条件をぶつける（例:「もし〜が欠けたらどうなりますか？」「似ている〇〇とは何が違うんですか？」）
   - [型E: 影響・境界の推論] (終盤推奨): 破綻時の影響や応用性を問う（例:「もしこれが正常に機能しないと、全体にどんな連鎖反応が起きますか？」）

【キーワード判定】
直前のユーザー発言で新しく正しく言及・説明されたキーワードがあれば、\`newlyCoveredKeywords\` に抽出してください。

【出力フォーマット】
必ず以下のJSON形式のみを出力してください:
{
  "role": "teacher" または "student",
  "questionType": "定義・明確化" | "前提の検証" | "メカニズムの探求" | "反例の吟味" | "影響・境界の推論" | "先生のヒント",
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
        questionType: parsed.questionType || "",
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
