import React from "react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-page">
          <h2>Ceva nu a mers bine</h2>
          <p className="subtle" style={{ marginBottom: 20 }}>
            A apărut o eroare neașteptată. Încercați să reîncărcați pagina.
          </p>
          <pre style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.5)",
            background: "rgba(255,255,255,0.04)",
            padding: "12px 16px",
            borderRadius: 10,
            maxWidth: 500,
            overflow: "auto",
            textAlign: "left",
            margin: "0 auto 16px",
          }}>
            {this.state.error?.message || "Unknown error"}
          </pre>
          <button
            className="btn btn-primary"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            Reîncarcă pagina
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[PageErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "40px 20px",
          textAlign: "center",
          borderRadius: 16,
          background: "rgba(255,77,109,0.06)",
          border: "1px solid rgba(255,77,109,0.15)",
          margin: "20px 0",
        }}>
          <div style={{ fontSize: 38, marginBottom: 12 }}>⚠️</div>
          <h3 style={{ margin: "0 0 8px", color: "#ff6b8a" }}>
            Eroare la încărcarea secțiunii
          </h3>
          <p className="subtle" style={{ marginBottom: 16, fontSize: 13 }}>
            {this.state.error?.message || "A apărut o eroare neașteptată."}
          </p>
          <button
            className="btn"
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ fontSize: 13 }}
          >
            Reîncearcă
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export { PageErrorBoundary };
export default ErrorBoundary;
