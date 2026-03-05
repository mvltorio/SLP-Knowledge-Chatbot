import natural from "natural";

const TfIdf = natural.TfIdf;

export function findRelevantDocs(query: string, docs: any[], topK = 5) {
  const tfidf = new TfIdf();

  docs.forEach((doc) => {
    tfidf.addDocument(doc.content || "");
  });

  const scores: { index: number; score: number }[] = [];

  tfidf.tfidfs(query, (i, measure) => {
    scores.push({ index: i, score: measure });
  });

  scores.sort((a, b) => b.score - a.score);

  return scores.slice(0, topK).map((s) => docs[s.index]);
}