"use client";
import {Component,type ReactNode} from "react";

/** A failed phone subpage must leave a way back without resetting the whole app. */
export class ReversePhoneBoundary extends Component<{children:ReactNode;onClose:()=>void},{failed:boolean;attempt:number}> {
 state={failed:false,attempt:0};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error:Error){console.warn("查岗页面暂时无法显示，已保存记录保留",error);}
 render(){return this.state.failed?<section className="rp-panel"><h2>查岗页面暂时无法显示</h2><p>已完成的操作和记录保留，可以重新进入后继续查岗。</p><button className="rp-primary" onClick={()=>this.setState(state=>({failed:false,attempt:state.attempt+1}))}>重新进入</button><button onClick={this.props.onClose}>返回</button></section>:<div key={this.state.attempt} style={{display:"contents"}}>{this.props.children}</div>;}
}
