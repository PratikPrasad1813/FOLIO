"use client";

import { Component, type ReactNode } from "react";
import { ErrorScreen } from "@/components/error-screen";

interface Props {
  children: ReactNode;
  /** Changing this value (for example the active view) clears a previous error. */
  resetKey?: string;
}

interface State {
  error: Error | null;
  key: string | undefined;
}

/**
 * Keeps a crash inside one screen (Projects, Tasks, Calendar…) from taking the
 * whole app down: the sidebar and top bar stay, and the person gets a clear
 * explanation with a retry instead of a blank or full-window error page.
 */
export class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  render() {
    if (this.state.error) {
      return <ErrorScreen scope="view" error={this.state.error} reset={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}
