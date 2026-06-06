// apps/web/src/components/ErrorBoundary.jsx
//
// Defensive boundary so one malformed thread (a foreign action that the reducer
// surfaced but produced odd shapes for) can't blank the whole sidebar. The
// reducer remains the protocol-level safety net; this is UI defence.

import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // Don't crash the app; log so a developer can find it.
    // eslint-disable-next-line no-console
    console.warn("ErrorBoundary caught:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="boundary-card">
          <b>⚠ render error</b>
          <div style={{ marginTop: 4, fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>
            {String(this.state.error.message ?? this.state.error)}
          </div>
          {this.props.label && (
            <div style={{ marginTop: 4, opacity: 0.6 }}>{this.props.label}</div>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
