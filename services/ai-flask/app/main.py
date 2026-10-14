from flask import Flask, jsonify, request

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "ai-flask"})


@app.post("/score")
def score():
    payload = request.get_json(silent=True) or {}
    answer = (payload.get("answer") or "").strip()
    score_value = min(100, max(0, len(answer) // 3))
    return jsonify(
        {
            "score": score_value,
            "strengths": ["Structured answer"],
            "improvements": ["Add specific measurable impact"],
        }
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8100, debug=True)
