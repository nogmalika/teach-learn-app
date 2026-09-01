import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { mode, topic, chatHistory, exchangeCount, lastUserMessage } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Gemini API key is not configured." }, { status: 500 });
    }

    if (mode === "chat") {
      // 先生AIか生徒AIかを判定するための統合プロンプト
      const systemInstruction = `
あなたは「${topic}」の学習セッションを管理するAIシステムです。
以下の対話ログと、直前のユーザーの発言を「${topic}」の正確な学術的・科学的事実と照らし合わせて分析してください。

【判定基準】
1. **先生AI (teacher) の介入条件**:
   - ユーザーの発言に【明らかな科学的・事実的誤り】や【重大な誤解】が含まれている場合（例: 「光合成で臭素を使う」など）。
   - ユーザーが「わからない」「ギブ」「忘れた」などと困っている場合。
   ➡️ この場合、role: "teacher" として、優しく誤りを指摘・訂正し、正しい理解へ導くヒントを1〜2文で伝えてください。

2. **生徒bot (student) の応答条件**:
   - ユーザーの説明が概ね正しい、または筋が通っている場合。
   ➡️ この場合、role: "student" として、ソクラテス式問答法で定義の確認や反例の問いかけ（Lv.${exchangeCount <= 1 ? "1: 初心者" : exchangeCount <= 3 ? "2: 見習い" : "3: 熟練者"}）を2〜3文で行ってください（ユーザーが言及していない未知の知識は先回りして喋らないこと）。

【出力フォーマット】
必ず以下のJSON形式のみを出力してください（Markdownのバッククォート不要）：
{
  "role": "teacher" または "student",
  "reply": "発言内容"
}
`;

      const contents = [
        {
          role: "user",
          parts: [
            {
              text: `テーマ: ${topic}\nこれまでの会話履歴:\n${JSON.stringify(chatHistory, null, 2)}\n\n直前のユーザー発言: "${lastUserMessage}"\n\n判定および応答メッセージをJSONで生成してください。`,
            },
          ],
        },
      ];

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: contents,
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
      return NextResponse.json({ reply: parsed.reply, responderRole: parsed.role });
    } else if (mode === "review") {
      const systemInstruction = `
あなたは「${topic}」の専門家（先生AI）です。ユーザーが生徒に対して行った説明（対話ログ全体）を客観的・学術的に評価し、JSON形式で返却してください。

出力フォーマット（JSONのみ）:
{
  "totalScore": 85,
  "accuracyScore": 35,
  "coverageScore": 25,
  "clarityScore": 25,
  "goodPoints": ["〜の説明が正確だった"],
  "improvementPoints": ["〜の誤りや言及不足があった"],
  "generalFeedback": "全体として〜"
}
`;

      const historyText = chatHistory
        .map((m: { role: string; content: string }) => `${m.role === "user" ? "【ユーザー】" : "【応答】"}: ${m.content}`)
        .join("\n\n");

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: `対話ログ:\n${historyText}` }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
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
