"use client";

import { useState, useRef, useEffect } from "react";
import { db, auth, googleProvider } from "@/lib/firebase";
import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  query, 
  where, 
  onSnapshot 
} from "firebase/firestore";
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User 
} from "firebase/auth";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from "recharts";
import mermaid from "mermaid";

interface Category {
  id: string;
  name: string;
  internalKeywords: string[];
}

interface Message {
  role: "user" | "student" | "teacher" | "system";
  content: string;
  questionType?: string;
}

interface AcademicImage {
  imageUrl: string;
  title: string;
  description: string;
}

interface TextbookSummary {
  coreConcept: string;
  keyMechanisms: string[];
  clinicalSignificance: string;
  mermaidGraph?: string;
  image?: AcademicImage;
}

interface ReviewResult {
  totalScore: number;
  accuracyScore: number;
  coverageScore: number;
  clarityScore: number;
  goodPoints: string[];
  improvementPoints: string[];
  generalFeedback: string;
  textbookSummary?: TextbookSummary;
}

interface LearningSession {
  id: string;
  topic: string;
  exchangeCount: number;
  scores: {
    total: number;
    accuracy: number;
    coverage: number;
    clarity: number;
  };
  feedback: ReviewResult;
  createdAt: any;
}

function MermaidRenderer({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chart || !containerRef.current) return;
    mermaid.initialize({ 
      startOnLoad: true, 
      theme: "neutral", 
      securityLevel: "loose",
      fontFamily: "ui-sans-serif, system-ui, sans-serif"
    });
    try {
      const id = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
      mermaid.render(id, chart).then(({ svg }) => {
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      });
    } catch (e) {
      console.error("Mermaid Render Error:", e);
    }
  }, [chart]);

  return (
    <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 overflow-x-auto flex justify-center my-2 shadow-inner">
      <div ref={containerRef} className="mermaid-container text-xs text-slate-100" />
    </div>
  );
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<"study" | "dashboard">("study");
  const [historySessions, setHistorySessions] = useState<LearningSession[]>([]);

  const [topic, setTopic] = useState("");
  const [isStarted, setIsStarted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [exchangeCount, setExchangeCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [targetCategories, setTargetCategories] = useState<Category[]>([]);
  const [coveredCategoryIds, setCoveredCategoryIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [savedStatus, setSavedStatus] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setHistorySessions([]);
      return;
    }

    const q = query(
      collection(db, "learning_sessions"),
      where("userId", "==", user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sessions = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as LearningSession[];

      sessions.sort((a, b) => {
        const timeA = a.createdAt?.seconds || 0;
        const timeB = b.createdAt?.seconds || 0;
        return timeA - timeB;
      });

      setHistorySessions(sessions);
    }, (error) => {
      console.error("Firestore Listen Error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, reviewResult]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      alert("ログインエラー: " + err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err: any) {
      alert("ログアウトエラー: " + err.message);
    }
  };

  const handleStart = async (selectedTopic?: string) => {
    const activeTopic = selectedTopic || topic;
    if (!activeTopic.trim() || isLoading) return;
    if (selectedTopic) setTopic(selectedTopic);
    setIsLoading(true);

    try {
      const initRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "init", topic: activeTopic }),
      });
      const initData = await initRes.json();
      if (initData.error) throw new Error(initData.error);

      setTargetCategories(initData.categories || []);
      setIsStarted(true);

      const firstMsg = `「${activeTopic}」について教えてください！まずはじめに、これはどういう概念・病態なのか概要から教えていただけますか？`;
      setMessages([{ role: "student", content: firstMsg, questionType: "定義・明確化" }]);
    } catch (err: any) {
      alert("開始エラー: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinish = async (currentHistory: Message[], updatedCovered: string[]) => {
    setIsFinished(true);
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "review",
          topic,
          chatHistory: currentHistory.map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
          })),
          exchangeCount,
          targetCategories,
          coveredCategories: updatedCovered,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const cleanJson = data.reply.replace(/```json|```/g, "").trim();
      const parsedReview: ReviewResult = JSON.parse(cleanJson);
      setReviewResult(parsedReview);

      try {
        await addDoc(collection(db, "learning_sessions"), {
          userId: user ? user.uid : "anonymous",
          userEmail: user ? user.email : "anonymous",
          topic,
          exchangeCount,
          scores: {
            total: parsedReview.totalScore,
            accuracy: parsedReview.accuracyScore,
            coverage: parsedReview.coverageScore,
            clarity: parsedReview.clarityScore,
          },
          feedback: parsedReview,
          createdAt: serverTimestamp(),
        });
        setSavedStatus(user ? "✅ スコアと解説をアーカイブに保存しました" : "✅ スコアを保存しました（ログインすると履歴が残ります）");
      } catch (dbErr) {
        console.error("Firestore Save Error:", dbErr);
        setSavedStatus("⚠️ データベースへの保存をスキップしました");
      }
    } catch (err: any) {
      alert("採点エラー: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput("");
    const newMessages: Message[] = [...messages, { role: "user", content: userText }];
    setMessages(newMessages);
    setIsLoading(true);

    const nextCount = exchangeCount + 1;
    setExchangeCount(nextCount);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "chat",
          topic,
          chatHistory: newMessages.map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
          })),
          exchangeCount: nextCount,
          lastUserMessage: userText,
          targetCategories,
          coveredCategories: coveredCategoryIds,
          errorCount,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (data.responderRole === "teacher") {
        setErrorCount((prev) => prev + 1);
      } else {
        setErrorCount(0);
      }

      let updatedCovered = [...coveredCategoryIds];
      if (data.newlyCoveredCategoryIds && data.newlyCoveredCategoryIds.length > 0) {
        updatedCovered = Array.from(new Set([...updatedCovered, ...data.newlyCoveredCategoryIds]));
        setCoveredCategoryIds(updatedCovered);
      }

      const updatedHistory: Message[] = [
        ...newMessages,
        { role: data.responderRole || "student", content: data.reply, questionType: data.questionType },
      ];
      setMessages(updatedHistory);

      if (data.isAllCompleted) {
        setIsLoading(false);
        setTimeout(() => {
          handleFinish(updatedHistory, updatedCovered);
        }, 1200);
        return;
      }
    } catch (err: any) {
      alert("エラー: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const chartData = historySessions.map((s, index) => ({
    name: `${index + 1}. ${(s.topic || "").slice(0, 5)}`,
    fullTopic: s.topic,
    総合点: s.scores?.total || 0,
    正確性: (s.scores?.accuracy || 0) * 2.5,
    網羅性: Math.round(((s.scores?.coverage || 0) / 30) * 100),
    構成力: Math.round(((s.scores?.clarity || 0) / 30) * 100),
  }));

  return (
    <main className="min-h-screen bg-slate-100 flex flex-col items-center p-2 md:p-6 text-slate-800">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl flex flex-col h-[94vh] overflow-hidden border border-slate-200">
        
        {/* ヘッダー */}
        <header className="bg-slate-900 text-white p-3 md:p-4 shrink-0 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="font-bold text-base md:text-lg tracking-tight text-white flex items-center gap-2">
                  <span>🩺</span> Teach to Learn AI
                </h1>
                <p className="text-[11px] text-slate-400">ソクラテス式アウトプット臨床推論</p>
              </div>
              <div className="flex bg-slate-800 p-0.5 rounded-lg text-xs font-medium border border-slate-700">
                <button
                  onClick={() => setActiveTab("study")}
                  className={`px-3 py-1 rounded-md transition ${activeTab === "study" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white"}`}
                >
                  学習ホーム
                </button>
                <button
                  onClick={() => setActiveTab("dashboard")}
                  className={`px-3 py-1 rounded-md transition ${activeTab === "dashboard" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white"}`}
                >
                  📈 スコア推移
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {user ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-300 hidden sm:inline font-mono">{user.displayName || user.email?.split("@")[0]}</span>
                  <button
                    onClick={handleLogout}
                    className="text-xs bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded-lg border border-slate-700 text-slate-300 transition"
                  >
                    ログアウト
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleLogin}
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-3 py-1.5 rounded-lg shadow transition"
                >
                  Googleログイン
                </button>
              )}
            </div>
          </div>

          {/* 思考フレームワーク（ネタバレ防止ステップバッジ） */}
          {activeTab === "study" && isStarted && targetCategories.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-800">
              <div className="text-[11px] font-semibold text-slate-400 mb-1.5 flex justify-between">
                <span>📋 網羅すべき思考フレーム（4つの要素）</span>
                <span className="text-indigo-400">{coveredCategoryIds.length} / {targetCategories.length} 達成</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {targetCategories.map((cat) => {
                  const isDone = coveredCategoryIds.includes(cat.id);
                  return (
                    <div
                      key={cat.id}
                      className={`text-xs px-2.5 py-1.5 rounded-lg font-medium border flex items-center gap-1.5 transition-all ${
                        isDone
                          ? "bg-emerald-950/40 border-emerald-500/60 text-emerald-300 font-semibold shadow-sm"
                          : "bg-slate-800/60 border-slate-700 text-slate-400"
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${isDone ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
                      <span className="truncate">{cat.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </header>

        {/* タブ 1: 学習ホーム画面 */}
        {activeTab === "study" && (
          !isStarted ? (
            <div className="flex-1 flex flex-col overflow-y-auto p-4 md:p-6">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center mb-6">
                <div className="text-4xl mb-3">🎓</div>
                <h2 className="text-lg font-bold text-slate-800 mb-1">教えたいテーマを入力</h2>
                <p className="text-xs text-slate-500 mb-4 max-w-md mx-auto">
                  概念のフレームワーク（病態・症状・診断・治療など）を意識して生徒AIに説明してください。
                </p>
                <div className="w-full max-w-md mx-auto flex gap-2">
                  <input
                    type="text"
                    placeholder="例: 胃潰瘍, 心筋梗塞, 糸球体腎炎, 光合成"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === "Enter") handleStart();
                    }}
                    disabled={isLoading}
                    className="flex-1 px-4 py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                  <button
                    onClick={() => handleStart()}
                    disabled={isLoading}
                    className="bg-indigo-600 text-white text-sm font-semibold px-5 py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition shadow-sm shrink-0"
                  >
                    {isLoading ? "生成中..." : "開始"}
                  </button>
                </div>
              </div>

              {/* 直近の学習履歴 */}
              <div className="flex-1 space-y-3">
                <div className="flex justify-between items-center px-1">
                  <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                    <span>📚</span> 直近の学習セッション履歴
                  </h3>
                  {historySessions.length > 0 && (
                    <span className="text-[11px] text-slate-500">{historySessions.length} 件の記録</span>
                  )}
                </div>

                {historySessions.length === 0 ? (
                  <div className="border border-dashed border-slate-300 rounded-xl p-8 text-center text-slate-400 text-xs">
                    {user ? "まだセッション履歴がありません。上のフォームから最初のテーマを始めてみましょう！" : "Googleログインすると、過去に学習したテーマや解説がここに蓄積されます。"}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {historySessions.slice().reverse().slice(0, 6).map((s) => (
                      <div
                        key={s.id}
                        onClick={() => handleStart(s.topic)}
                        className="p-3.5 bg-white rounded-xl border border-slate-200 hover:border-indigo-400 hover:shadow-md transition cursor-pointer group flex flex-col justify-between"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-bold text-sm text-slate-800 group-hover:text-indigo-600 transition truncate">
                            {s.topic}
                          </span>
                          <span className="text-xs font-black px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 shrink-0">
                            {s.scores?.total}点
                          </span>
                        </div>
                        {s.feedback?.textbookSummary && (
                          <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed mb-2">
                            {s.feedback.textbookSummary.coreConcept}
                          </p>
                        )}
                        <div className="flex justify-between items-center text-[10px] text-slate-400 border-t border-slate-100 pt-2 mt-auto">
                          <span>{s.exchangeCount} 往復の対話</span>
                          <span className="text-indigo-600 font-semibold group-hover:underline">もう一度復習 ➔</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
                {messages.map((m, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col ${
                      m.role === "user" ? "items-end" : m.role === "teacher" ? "items-center" : "items-start"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 px-1">
                      <span className="text-[10px] text-slate-500 font-semibold">
                        {m.role === "user"
                          ? "あなた (先生役)"
                          : m.role === "student"
                          ? "生徒bot"
                          : `🎓 指導教官 (介入段階 ${Math.min(errorCount || 1, 3)})`}
                      </span>
                      {m.questionType && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-800 font-medium">
                          {m.questionType}
                        </span>
                      )}
                    </div>
                    <div
                      className={`p-3 rounded-2xl max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap shadow-sm ${
                        m.role === "user"
                          ? "bg-indigo-600 text-white rounded-br-none"
                          : m.role === "student"
                          ? "bg-white text-slate-800 rounded-bl-none border border-slate-200"
                          : "bg-amber-50 text-amber-950 border border-amber-300 w-full rounded-xl"
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}

                {/* 採点カード＆QB解説＆Wikimedia画像＆Mermaid図 */}
                {reviewResult && (
                  <div className="space-y-4 mt-6">
                    <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-3">
                      <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                        <span className="font-bold text-slate-800 text-sm">🎯 学習スコア評価</span>
                        <span className="text-2xl font-black text-indigo-600">{reviewResult.totalScore} <span className="text-xs font-normal text-slate-400">/ 100点</span></span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="bg-slate-50 p-2 rounded-lg border border-slate-100 text-slate-600">正確性: <b>{reviewResult.accuracyScore}/40</b></div>
                        <div className="bg-slate-50 p-2 rounded-lg border border-slate-100 text-slate-600">網羅性: <b>{reviewResult.coverageScore}/30</b></div>
                        <div className="bg-slate-50 p-2 rounded-lg border border-slate-100 text-slate-600">構成力: <b>{reviewResult.clarityScore}/30</b></div>
                      </div>
                      <div className="text-xs text-slate-700 space-y-1 pt-1">
                        <p className="font-bold text-emerald-700">🌟 評価された点:</p>
                        {reviewResult.goodPoints.map((p, i) => <li key={i} className="list-disc ml-4">{p}</li>)}
                        <p className="font-bold text-amber-700 mt-2">💡 改善の余地:</p>
                        {reviewResult.improvementPoints.map((p, i) => <li key={i} className="list-disc ml-4">{p}</li>)}
                        <p className="font-bold text-slate-800 mt-2">📝 総括コメント:</p>
                        <p className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-slate-600 leading-relaxed">{reviewResult.generalFeedback}</p>
                      </div>
                    </div>

                    {/* 教科書的解説（QB High-Yield・学術画像・Mermaidフロー） */}
                    {reviewResult.textbookSummary && (
                      <div className="p-5 bg-slate-900 text-slate-100 rounded-2xl shadow-lg border border-slate-800 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                          <span className="text-xs font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                            <span>📖</span> High-Yield Clinical Review
                          </span>
                          <span className="text-[10px] text-slate-400">QB形式 病態生理まとめ</span>
                        </div>

                        {/* Wikimedia Commons 学術画像 */}
                        {reviewResult.textbookSummary.image && (
                          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 space-y-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                              📷 関連写真・模式図 (Wikimedia Commons)
                            </span>
                            <div className="flex justify-center bg-black/40 rounded-lg overflow-hidden max-h-56">
                              <img
                                src={reviewResult.textbookSummary.image.imageUrl}
                                alt={reviewResult.textbookSummary.image.title}
                                className="object-contain w-full h-auto max-h-56"
                                loading="lazy"
                              />
                            </div>
                            <p className="text-[10px] text-slate-400 text-center italic truncate">
                              {reviewResult.textbookSummary.image.title}
                            </p>
                          </div>
                        )}

                        <div>
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">【基本概念・病態生理】</span>
                          <p className="text-xs leading-relaxed text-slate-200">{reviewResult.textbookSummary.coreConcept}</p>
                        </div>

                        {/* Mermaid 病態生理フローチャート */}
                        {reviewResult.textbookSummary.mermaidGraph && (
                          <div>
                            <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider block mb-1">
                              【病態生理・因果関係マップ】
                            </span>
                            <MermaidRenderer chart={reviewResult.textbookSummary.mermaidGraph} />
                          </div>
                        )}

                        <div>
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">【重要メカニズム・ポイント】</span>
                          <ul className="space-y-1.5">
                            {reviewResult.textbookSummary.keyMechanisms.map((mech, i) => (
                              <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                                <span className="text-indigo-400 font-bold shrink-0">•</span>
                                <span className="leading-relaxed">{mech}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-slate-200 leading-relaxed">
                          <span className="font-bold text-indigo-300 block mb-1">📌 臨床的意義・国試の急所:</span>
                          {reviewResult.textbookSummary.clinicalSignificance}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {savedStatus && <div className="text-xs text-emerald-600 text-center font-semibold">{savedStatus}</div>}
                {isLoading && <div className="text-xs text-slate-400 text-center animate-pulse">解析中...</div>}
                <div ref={messagesEndRef} />
              </div>

              {/* 入力エリア */}
              <div className="p-3 border-t bg-white space-y-2 shrink-0">
                {!isFinished ? (
                  <>
                    <div className="flex gap-2 items-end">
                      <textarea
                        rows={2}
                        placeholder="生徒に説明する...（Enterで送信、Shift+Enterで改行）"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={isLoading}
                        className="flex-1 px-4 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 resize-none text-sm"
                      />
                      <button
                        onClick={handleSend}
                        disabled={isLoading}
                        className="bg-indigo-600 text-white font-semibold px-4 py-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition shrink-0 text-sm"
                      >
                        送信
                      </button>
                    </div>
                    <div className="flex justify-between items-center px-1">
                      <span className="text-[11px] text-slate-400">4つの要素が揃うと自動で講評へ進みます</span>
                      <button
                        onClick={() => handleFinish(messages, coveredCategoryIds)}
                        disabled={isLoading || messages.length <= 2}
                        className="text-[11px] text-slate-500 hover:text-red-500 underline transition"
                      >
                        途中で終了して採点する
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setIsStarted(false);
                      setIsFinished(false);
                      setMessages([]);
                      setReviewResult(null);
                    }}
                    className="w-full bg-slate-900 text-white font-semibold py-2.5 rounded-xl text-xs hover:bg-slate-800 transition"
                  >
                    🔄 ホームに戻って別のテーマを学習する
                  </button>
                )}
              </div>
            </div>
          )
        )}

        {/* タブ 2: スコア推移ダッシュボード */}
        {activeTab === "dashboard" && (
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            {!user ? (
              <div className="text-center py-16 space-y-4">
                <div className="text-4xl">🔒</div>
                <h3 className="font-bold text-slate-700 text-base">Googleログインが必要です</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Googleアカウントでログインすると、スコアの推移グラフと過去のQB解説アーカイブが蓄積されます。
                </p>
                <button
                  onClick={handleLogin}
                  className="bg-indigo-600 text-white font-semibold px-6 py-2.5 rounded-xl text-sm hover:bg-indigo-700 transition shadow"
                >
                  Googleでログインする
                </button>
              </div>
            ) : historySessions.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <div className="text-4xl">📊</div>
                <h3 className="font-bold text-slate-700 text-base">まだ学習データがありません</h3>
                <p className="text-xs text-slate-500">ホームから生徒にテーマを教えて、最初の記録を残しましょう！</p>
                <button
                  onClick={() => setActiveTab("study")}
                  className="bg-indigo-600 text-white font-semibold px-4 py-2 rounded-xl text-xs hover:bg-indigo-700 transition"
                >
                  学習ホームへ戻る
                </button>
              </div>
            ) : (
              <>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 text-sm">📈 スコア推移グラフ</h3>
                    <span className="text-xs text-slate-500 font-medium">{historySessions.length} 回の学習記録</span>
                  </div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#64748B" />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#64748B" />
                        <Tooltip contentStyle={{ fontSize: "12px", borderRadius: "8px", border: "1px solid #CBD5E1" }} />
                        <Legend wrapperStyle={{ fontSize: "11px" }} />
                        <Line type="monotone" dataKey="総合点" stroke="#4F46E5" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                        <Line type="monotone" dataKey="正確性" stroke="#10B981" strokeWidth={2} strokeDasharray="4 4" />
                        <Line type="monotone" dataKey="網羅性" stroke="#F59E0B" strokeWidth={2} strokeDasharray="4 4" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="font-bold text-slate-800 text-sm">📚 過去のセッション詳細</h3>
                  <div className="space-y-3">
                    {historySessions.slice().reverse().map((s) => (
                      <div key={s.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-slate-800 text-sm">{s.topic}</span>
                          <span className="text-xs font-black px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                            {s.scores?.total} 点
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 flex gap-4">
                          <span>正確性: {s.scores?.accuracy}/40</span>
                          <span>網羅性: {s.scores?.coverage}/30</span>
                          <span>構成力: {s.scores?.clarity}/30</span>
                        </div>
                        {s.feedback?.textbookSummary && (
                          <div className="mt-2 p-3 rounded-lg bg-slate-900 text-slate-200 text-xs space-y-2">
                            {s.feedback.textbookSummary.image && (
                              <div className="flex justify-center bg-black/40 rounded-lg overflow-hidden max-h-40">
                                <img
                                  src={s.feedback.textbookSummary.image.imageUrl}
                                  alt={s.feedback.textbookSummary.image.title}
                                  className="object-contain w-full h-auto max-h-40"
                                  loading="lazy"
                                />
                              </div>
                            )}
                            <p className="text-[11px] text-slate-300 leading-relaxed">{s.feedback.textbookSummary.coreConcept}</p>
                            {s.feedback.textbookSummary.mermaidGraph && (
                              <MermaidRenderer chart={s.feedback.textbookSummary.mermaidGraph} />
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </main>
  );
}
