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

    if (mode === "chat") {
      if (exchangeCount <= 1) {
        systemInstruction = `あなたは「${topic}」について全く知らない幼稚園児〜小学生のような生徒です。ユーザーの説明に対して、素朴でちょっとズレた質問や、「つまり〇〇ってこと？」といった簡単な確認を返してください。3行以内で短く返してください。`;
      } else if (exchangeCount <= 3) {
        systemInstruction = `あなたは「${topic}」を少し理解し始めた中学生レベルの生徒です。前の説明を部分的に理解しつつ、「じゃあ〇〇の場合はどうなるの？」と一歩進んだ疑問をぶつけてください。3行以内で短く返してください。`;
      } else {
        systemInstruction = `あなたは「${topic}」についてかなり理解してきた高校生〜大人レベルの生徒です。本質的なまとめを返しつつ、「最後に〇〇の応用や注意点ってありますか？」と鋭い質問をしてください。3行以内で短く返してください。`;
      }

      contents = chatHistory.map((m: { role: string; content: string }) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }],
      }));
    } else if (mode === "review") {
      systemInstruction = `あなたはプロフェッショナルな教育者（先生AI）です。テーマは「${topic}」です。`;
      const historyText = chatHistory
        .map((m: { role: string; content: string }) => `${m.role === "user" ? "ユーザー" : "生徒"}: ${m.content}`)
        .join("\n");

      contents = [
        {
          role: "user",
          parts: [
            {
              text: `以下はユーザーが生徒botに教えていた会話履歴です。\n\n【会話履歴】\n${historyText}\n\n上記を踏まえ、以下のフォーマットで日本語でフィードバックしてください：\n1. 【総合スコア】(100点満点)\n2. 【良かった点】(正しく説明できていた箇所)\n3. 【補足・改善点】(説明が抜けていた重要ポイントや、誤解されやすい箇所の解説)\n4. 【総評】(ユーザーへの励ましの言葉)`,
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
        generationConfig: { temperature: 0.7 },
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
