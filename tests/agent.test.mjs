import test from 'node:test'
import assert from 'node:assert/strict'
import { Agent, agentLoop, runAgentLoop, runAgentLoopContinue, defineTool, textResult, userMessage, createWorkspaceTools } from '../src/agent/index.ts'
import { workspacePath } from '../src/agent/workspace-tools.ts'
const assistant = (content = [], stopReason = 'stop') => ({role:'assistant',content,stopReason,timestamp:1})
const text = value => assistant([{type:'text',text:value}])
const call = (id='one',name='echo',args={text:'hello'}) => ({type:'toolCall',id,name,arguments:args})
const context = tools => ({systemPrompt:'test',messages:[],tools:tools??[]})
const scripted = (...messages) => {let n=0;return async function*(){yield {type:'done',message:messages[Math.min(n++,messages.length-1)]}}}
const echo = (execute=async(_id,args)=>textResult(args.text)) => defineTool({name:'echo',description:'echo',parameters:{type:'object'},
  parseArguments(input){if(!input||typeof input.text!=='string')throw Error('text required');return input},execute})
const gate = () => {let resolve; const promise=new Promise(r=>resolve=r);return {promise,resolve}}

test('multi-turn streaming lifecycle, result feedback and source snapshots', async()=>{
  const events=[], seen=[];let n=0
  const initial=context([echo()])
  const streamFn=async function*(ctx){seen.push(structuredClone(ctx));if(n++===0){
    const partial=text('Reading');yield {type:'start',partial};partial.content[0].text='Reading file';yield {type:'text_delta',delta:' file',partial}
    yield {type:'done',message:assistant([call()],'toolUse')}
  }else yield {type:'done',message:text('done')}}
  const result=await runAgentLoop([userMessage('go')],initial,{streamFn},e=>events.push(e))
  assert.equal(result.reason,'stop');assert.equal(seen.length,2)
  assert.equal(seen[1].messages.at(-1).role,'toolResult');assert.equal(seen[1].messages.at(-1).content[0].text,'hello')
  assert.equal(events.find(e=>e.type==='message_start'&&e.message.role==='assistant').message.content[0].text,'Reading')
  assert.equal(events.filter(e=>e.type==='agent_end').length,1)
  assert.equal(events.filter(e=>e.type==='turn_start').length,2)
  assert.deepEqual(initial.messages,[])
})

test('tool lookup, argument validation and thrown errors become paired results',async()=>{
  let executions=0
  const calls=[call('a','missing'),call('b','echo',{}),call('c')]
  const result=await runAgentLoop([userMessage('go')],context([echo(async()=>{executions++;throw Error('boom')})]),
    {streamFn:scripted(assistant(calls,'toolUse'),text('handled'))})
  const results=result.messages.filter(m=>m.role==='toolResult')
  assert.equal(results.length,3);assert.ok(results.every(m=>m.isError));assert.equal(executions,1)
  assert.equal(result.reason,'stop')
})

test('truncated and duplicate-ID tool batches never execute',async()=>{
  for(const [calls,stop] of [[[call()],'length'],[[call(),call()],'toolUse']]){
    let executions=0
    const result=await runAgentLoop([userMessage('go')],context([echo(async()=>{executions++;return textResult('x')})]),
      {streamFn:scripted(assistant(calls,stop),text('end'))})
    assert.equal(executions,0);assert.ok(result.messages.filter(m=>m.role==='toolResult').every(m=>m.isError))
  }
})

test('context transform precedes conversion, observer barrier precedes execution, hooks block and rewrite',async()=>{
  const order=[];let executed=0
  const result=await runAgentLoop([userMessage('go')],context([echo(async()=>{order.push('execute');executed++;return textResult('raw')})]),{
    streamFn:scripted(assistant([call('allowed'),call('blocked')],'toolUse'),text('done')),
    transformContext:async messages=>{order.push('transform');return messages},
    convertToLlm:messages=>{order.push('convert');return messages},
    beforeToolCall:({toolCall})=>toolCall.id==='blocked'?{block:true,reason:'blocked'}:undefined,
    afterToolCall:()=>textResult('rewritten'),
  },async event=>{if(event.type==='message_end'&&event.message.role==='assistant'){await Promise.resolve();order.push('observer')}})
  assert.ok(order.indexOf('transform')<order.indexOf('convert'));assert.ok(order.indexOf('observer')<order.indexOf('execute'))
  assert.equal(executed,1)
  assert.deepEqual(result.messages.filter(m=>m.role==='toolResult').map(m=>m.content[0].text),['rewritten','blocked'])
})

test('tool progress is finalized before end, late progress is ignored',async()=>{
  let late;const events=[]
  await runAgentLoop([userMessage('go')],context([echo(async(_id,_args,_signal,update)=>{late=update;void update(textResult('half'));return textResult('done')})]),
    {streamFn:scripted(assistant([call()],'toolUse'),text('ok'))},e=>events.push(e))
  await late(textResult('late'))
  const types=events.map(e=>e.type)
  assert.equal(types.filter(t=>t==='tool_execution_update').length,1)
  assert.ok(types.indexOf('tool_execution_update')<types.indexOf('tool_execution_end'))
})

test('abort stalled stream promptly, preserve idle state, reject concurrent prompts and allow retry',async()=>{
  const started=gate()
  const agent=new Agent({streamFn:async function*(){started.resolve();await new Promise(()=>{});yield {type:'done',message:text('never')}}})
  const run=agent.prompt('go');await started.promise
  await assert.rejects(agent.prompt('concurrent'),/already running/)
  agent.abort()
  const result=await Promise.race([run,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('abort stalled')),500);t.unref()})])
  assert.equal(result.reason,'aborted');assert.equal(agent.state.isRunning,false)
})

test('abort during a tool prevents remaining tools and pairs every call',async()=>{
  const controller=new AbortController();let executed=0
  const result=await runAgentLoop([userMessage('go')],context([echo(async()=>{executed++;controller.abort();return textResult('late')})]),
    {streamFn:scripted(assistant([call('a'),call('b')],'toolUse'))},undefined,controller.signal)
  assert.equal(executed,1);assert.equal(result.reason,'aborted')
  assert.equal(result.messages.filter(m=>m.role==='toolResult').length,2)
})

test('steering arrives after tool batch, follow-up waits until natural stop',async()=>{
  const seen=[];let turn=0;let agent
  agent=new Agent({tools:[echo(async()=>{agent.steer('change');agent.followUp('later');return textResult('ok')})],streamFn:async function*(ctx){
    seen.push(ctx.messages.filter(m=>m.role==='user').map(m=>m.content))
    yield {type:'done',message:turn++===0?assistant([call()],'toolUse'):text('ok')}
  }})
  await agent.prompt('first')
  assert.deepEqual(seen,[['first'],['first','change'],['first','change','later']])
  agent.followUp('idle follow-up');await agent.continue()
  assert.equal(agent.state.messages.filter(m=>m.role==='user').at(-1).content,'idle follow-up')
})

test('missing terminal event becomes error; maxTurns bounds non-ending model',async()=>{
  const bad=await runAgentLoop([userMessage('go')],context(),{streamFn:async function*(){yield {type:'start',partial:text('partial')}}})
  assert.equal(bad.reason,'error');assert.match(bad.messages.at(-1).errorMessage,/without a done/)
  const limited=await runAgentLoop([userMessage('go')],context([echo()]),{streamFn:scripted(assistant([call()],'toolUse')),maxTurns:2})
  assert.equal(limited.reason,'max_turns');assert.equal(limited.messages.filter(m=>m.role==='assistant').length,2)
})

test('continue guards and async event stream result',async()=>{
  await assert.rejects(runAgentLoopContinue(context(),{streamFn:scripted(text('ok'))}),/no messages/)
  await assert.rejects(runAgentLoopContinue({...context(),messages:[text('ok')]},{streamFn:scripted(text('ok'))}),/assistant message/)
  const stream=agentLoop([userMessage('go')],context(),{streamFn:scripted(text('ok'))})
  const events=[];for await(const e of stream)events.push(e)
  assert.equal(events.at(-1).type,'agent_end');assert.equal((await stream.result()).reason,'stop')
})

test('workspace tools enforce path, shape, exact-match and optimistic write contracts',async()=>{
  const files=new Map([['/workspace/a.txt','one two']]);let writes=0
  const fs={listNodes:async()=>[{path:'/workspace',kind:'directory'},...Array.from(files.keys(),path=>({path,kind:'file'}))],
    readFile:async path=>{if(!files.has(path))throw Error('missing');return files.get(path)},
    writeFile:async(path,content,{signal,expectedContent}={})=>{signal?.throwIfAborted();if(expectedContent!==undefined)assert.equal(files.get(path),expectedContent);writes++;files.set(path,content)}}
  const tools=createWorkspaceTools(fs);const invoke=async(name,args)=>{const t=tools.find(t=>t.name===name);return t.execute('id',t.parseArguments(args),new AbortController().signal,async()=>{})}
  await invoke('edit_file',{path:'a.txt',oldText:'two',newText:'three'});assert.equal(files.get('/workspace/a.txt'),'one three')
  await invoke('write_file',{path:'b.txt',content:'new'});assert.equal(files.get('/workspace/b.txt'),'new')
  assert.match((await invoke('list_files',{path:'.'})).content[0].text,/b.txt/)
  await assert.rejects(invoke('read_file',{path:'../../etc/passwd'}),/inside/)
  await assert.rejects(invoke('edit_file',{path:'a.txt',oldText:'',newText:'x'}),/empty/)
  files.set('/workspace/a.txt','a a');await assert.rejects(invoke('edit_file',{path:'a.txt',oldText:'a',newText:'b'}),/more than once/)
  await assert.rejects(invoke('write_file',{path:'x',content:'x',extra:'bad'}),/Unexpected/)
  assert.equal(writes,2);assert.equal(workspacePath('../a.txt','/workspace/notes'),'/workspace/a.txt')
})

test('turn limit retains drained steering input so continue resumes it',async()=>{
  let first=true, agent
  agent=new Agent({maxTurns:1,streamFn:async function*(){
    if(first){first=false;agent.steer('not lost')}
    yield {type:'done',message:text('ok')}
  }})
  assert.equal((await agent.prompt('first')).reason,'max_turns')
  assert.equal(agent.state.messages.at(-1).role,'user')
  assert.equal(agent.state.messages.at(-1).content,'not lost')
  assert.equal((await agent.continue()).reason,'stop')
})
