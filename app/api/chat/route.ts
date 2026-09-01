import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { mode, topic, chatHistory, exchangeCount, lastUserMessage } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Gemini API key is not configured." }, { status: 500 });
    }

    let systemInstruction = "";
    let contents = [];
    let temperature = 0.4;
    let responderRole: "student" | "teacher" = "student";

    if (mode === "chat") {
      const giveUpPatterns = /わからない|わかりません|知らん|教えて|無理|忘れた|ギブ/i;
      const isUserGivingUp = giveUpPatterns.test(lastUserMessage || "");

      if (isUserGivingUp) {
        responderRole = "teacher";
        temperature = 0.2;
        systemInstruction = `
あなたは「${topic}」の教育者（先生AI）です。
ユーザーが「わからない」と困っています。答えを丸ごと教えるのではなく、ユーザーが自力で考えられるように小さなヒントや問いかけを1〜2文で出してください。
口調：優しく導くトーン（例:「大丈夫ですよ。まずは〜について思い出してみましょう」）。
`;
      } else {
        responderRole = "student";
        systemInstruction = `
あなたは「${topic}」について学ぶ賢明な生徒です。ソクラテス式問答法（産婆術）の原則に従ってユーザーと対話します。

【行動指針】
1. **事実の検証**: ユーザーの説明に明らかな学術的・論理的誤りがある場合のみ、先生（指導教官）を呼ぶように「あれ？〇〇という理解で合っていますか？」と疑問を呈してください。
2. **先回り知識の禁止**: ユーザーがまだ言及していない専門知識を勝手に喋ることは厳禁です。
3. **ソクラテス式問い返し**:
   - **Lv.1 (初心者)**: 定義の明確化を促す（「それって具体的に何と何が関係しているんですか？」「日常で言うと？」）。
   - **Lv.2 (見習い)**: 前提の検証・反例の提示（「もし〜という条件がなくなったらどう動くのですか？」「なぜそうなるのですか？」）。
   - **Lv.3 (熟練者)**: 境界条件・応用性の吟味（「〜の場合とどう差別化されますか？」「これが破綻するとどんな影響が出ますか？」）。
4. 2〜3文で簡潔に返答してください。
`;
      }

      contents = chatHistory.map((m: { role: string; content: string }) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }],
      }));
    } else if (mode === "review") {
      responderRole = "teacher";
      temperature = 0.2;

      systemInstruction = `
あなたは「${topic}」の専門家（先生AI）です。ユーザーが生徒に対して行った説明（対話ログ全体）を客観的・学術的に評価し、JSON形式で返却してください。

必ず以下のJSONフォーマットのみを出力してください（Markdownタグ不要）：
{
  "totalScore": 85,
  "accuracyScore": 35,
  "coverageScore": 25,
  "clarityScore": 25,
  "goodPoints": ["〜の説明が正確だった", "〜のたとえが分かりやすかった"],
  "improvementPoints": ["〜のメカニズムへの言及が不足していた"],
  "generalFeedback": "全体として〜"
}
`;

      const historyText = chatHistory
        .map((m: { role: string; content: string }) => `${m.role === "user" ? "【ユーザー】" : "【応答】"}: ${m.content}`)
        .join("\n\n");

      contents = [
        {
          role: "user",
          parts: [{ text: `対話ログ:\n${historyText}` }],
        },
      ];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: contents,
        generationConfig: {
          temperature: temperature,
        },
      }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    const reply = data.candidates[0].content.parts[0].text;
    return NextResponse.json({ reply, responderRole });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
