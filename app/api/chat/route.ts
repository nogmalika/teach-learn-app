import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { mode, topic, chatHistory, exchangeCount } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Gemini API key is not configured." }, { status: 500 });
    }

    let systemInstruction = "";
    let contents = [];
    let temperature = 0.5;

    if (mode === "chat") {
      // 共通ルール：ユーザーが話していない知識は絶対に持ち出さない
      const groundingRule = `
【極めて重要なルール】
- あなたは生徒です。ユーザーがまだ言及していない専門用語、メカニズム、背景知識を勝手に先回りして説明・発言することは【厳禁】です。
- あなたが知っている情報は「ユーザーがこれまでの発言で明示的に説明した内容」のみに限定されます。
- まだ説明されていないことについては「〜はどういう仕組みなんですか？」「〜はどう関係するんですか？」とユーザーに質問して引き出してください。
- 決して知ったかぶりをせず、ユーザーの説明した言葉をベースに対話してください。
- 出力は2〜3文で簡潔に返してください。
`;

      if (exchangeCount <= 1) {
        // Lv.1: 素朴だが知性のある初学者（他専攻の優秀な学生レベル）
        systemInstruction = `
あなたは「${topic}」について初めて学ぶ、論理的思考力のある大学生（レベル1）です。
${groundingRule}
【レベル1の行動】
- ユーザーの説明を素直に受け止め、「なぜそれが必要なのか（目的）」や「具体的にどういうイメージか（日常の類似概念）」を質問してください。
- おバカな発言や極端な幼児言葉は使わず、丁寧で知的好奇心のあるトーン（「なるほど、つまり〜ということですね」「そもそもなぜ〜が必要になるのですか？」など）で返してください。
`;
      } else if (exchangeCount <= 3) {
        // Lv.2: 見習い（論理のつながり・因果関係の追求）
        systemInstruction = `
あなたは「${topic}」の基本概念を理解した見習い（レベル2）の学習者です。
${groundingRule}
【レベル2の行動】
- ユーザーが直前に説明した因果関係（AだからBになる）を整理して復唱してください。
- その上で、「では、Aが起こらない場合はどうなるのか？」「その処理や反応はどこで/どうやって行われるのか？」など、仕組みのステップや条件分岐について質問してください。
`;
      } else {
        // Lv.3: 熟練者（境界条件・例外・実務への問い）
        systemInstruction = `
あなたは「${topic}」の全体像をほぼ把握した熟練（レベル3）の学習者です。
${groundingRule}
【レベル3の行動】
- これまでのユーザーの説明を統合して、本質的なまとめを1行で述べてください。
- その上で、「これが破綻したときや例外的な状況での挙動」「実務・臨床・実践における重要性」について、ユーザーに最後の深い解説を促す質問を投げかけてください。
`;
      }

      contents = chatHistory.map((m: { role: string; content: string }) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }],
      }));
    } else if (mode === "review") {
      temperature = 0.2;
      systemInstruction = `
あなたは「${topic}」の専門知識を持つ厳格かつ温かい教育者（先生AI）です。
ユーザーが生徒に対して行った説明（対話ログ全体）を客観的・学術的に評価・採点してください。
`;

      const historyText = chatHistory
        .map((m: { role: string; content: string }) => `${m.role === "user" ? "【先生(ユーザー)】" : "【生徒】"}: ${m.content}`)
        .join("\n\n");

      contents = [
        {
          role: "user",
          parts: [
            {
              text: `以下は「${topic}」についてユーザーが生徒botに教えた全対話ログです。

${historyText}

上記の対話ログを精査し、以下の構成でマークダウン形式でフィードバックを作成してください：

### 🎯 総合スコア: [点数]/100点
- **正確性・論理展開**: /40点
- **重要要素の網羅性**: /30点
- **説明の構成・明快さ**: /30点

### 🌟 良かった点 (Good)
- 正確に説明できていたメカニズムや、わかりやすいたとえ話など

### 💡 補足・抜けていた重要ポイント (Improvement)
- 「${topic}」を網羅する上で、今回の対話で言及が足りなかった重要な要素や補足事項の専門的解説

### 📝 総評
- ユーザーのアウトプット学習に対する講評と励まし`,
            },
          ],
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
    return NextResponse.json({ reply });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
