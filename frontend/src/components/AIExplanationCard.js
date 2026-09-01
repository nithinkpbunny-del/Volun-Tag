export default function AIExplanationCard({ explanation }) {
  return (
    <div className="explanation-card">
      <div className="explanation-header">
        <span>AI Explanation</span>
      </div>
      <p>{explanation}</p>
    </div>
  );
}
