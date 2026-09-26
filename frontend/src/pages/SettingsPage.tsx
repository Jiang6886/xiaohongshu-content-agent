// 设置页：普通创作偏好、私密模型配置和连接检查使用不同接口。
// 页面不读取已保存的密钥原文；显式点击模型测试才会产生真实模型调用。

import { useState, useEffect } from "react";
import {
  App,
  Button,
  Input,
  InputNumber,
  Form,
  Alert,
  Tabs,
  Tag,
  Popconfirm,
} from "antd";
import { api, isDemo, backend, type Settings, type ModelConfig } from "../api";
import Heading from "../components/Heading";

export default function SettingsPage({
  settings,
  act,
}: {
  settings: Settings;
  act: (fn: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [model, setModel] = useState<ModelConfig>();
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  // 模型表单修改后禁用测试，避免测试仍已保存的旧配置却误以为是当前输入。
  const [dirty, setDirty] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string }>();
  const [checking, setChecking] = useState(false);
  const [connections, setConnections] =
    useState<Awaited<ReturnType<typeof backend.connections>>>();
  // 回填模型名与地址；后端只返回密钥存在标志，密码输入框保持空白。
  const loadModel = async () => {
    try {
      const data = await backend.modelConfig();
      setModel(data);
      form.setFieldsValue({ model: data.model, base_url: data.base_url });
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  useEffect(() => {
    if (!isDemo) void loadModel();
  }, []);
  // 刷新 MCP 登录、worker 和模型配置状态；此处不执行真实模型测试。
  const check = async () => {
    setChecking(true);
    try {
      setConnections(await backend.connections());
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      <Heading
        eyebrow="PREFERENCES / 04"
        title="为你的创作，留好空间。"
        description="在这里切换模型与密钥，保存后直接用于后续调用。"
      />
      <Tabs
        defaultActiveKey={isDemo ? "author" : "model"}
        items={[
          {
            key: "model",
            label: "模型服务",
            children: (
              <div className="settings-layout">
                <section className="glass settings-card">
                  <div className="row">
                    <h2>当前模型</h2>
                    <Tag>{model?.key_configured ? "密钥已保存" : "待配置"}</Tag>
                  </div>
                  <p className="muted">
                    支持 OpenAI 兼容接口。相同服务只换模型时，API Key 可以留空。
                  </p>
                  {isDemo ? (
                    <Alert
                      type="info"
                      title="演示模式不保存密钥，请在真实工作区配置。"
                    />
                  ) : (
                    <Form
                      form={form}
                      layout="vertical"
                      disabled={busy || testing}
                      onValuesChange={() => {
                        setDirty(true);
                        setTestResult(undefined);
                      }}
                      onFinish={async (values) => {
                        setBusy(true);
                        setTestResult(undefined);
                        try {
                          // 空白密钥交给后端决定是否沿用；换服务地址时后端要求显式提供新密钥。
                          const saved = await backend.saveModel({
                            ...values,
                            api_key: values.api_key?.trim() || undefined,
                          });
                          setModel(saved);
                          // 保存成功立即清空密码框，页面只保留脱敏配置。
                          form.setFieldsValue({
                            api_key: "",
                            model: saved.model,
                            base_url: saved.base_url,
                          });
                          setDirty(false);
                          message.success("模型配置已保存，后续调用立即生效");
                        } catch (e) {
                          message.error((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Form.Item
                        name="base_url"
                        label="服务地址（Base URL）"
                        rules={[{ required: true, whitespace: true }]}
                      >
                        <Input
                          placeholder="https://服务商提供的地址/v1"
                          autoComplete="off"
                        />
                      </Form.Item>
                      <Form.Item
                        name="model"
                        label="模型名称"
                        rules={[{ required: true, whitespace: true }]}
                      >
                        <Input
                          placeholder="填写服务商提供的完整模型 ID"
                          autoComplete="off"
                        />
                      </Form.Item>
                      <Form.Item name="api_key" label="API Key">
                        <Input.Password
                          autoComplete="new-password"
                          placeholder={
                            model?.key_configured
                              ? "已保存；留空保留，更换地址时必须填写新 Key"
                              : "粘贴 API Key"
                          }
                        />
                      </Form.Item>
                      <div className="model-actions">
                        <Button type="primary" htmlType="submit" loading={busy}>
                          保存模型配置
                        </Button>
                        <Button
                          loading={testing}
                          disabled={dirty || !model?.key_configured || busy}
                          onClick={async () => {
                            setTesting(true);
                            setTestResult(undefined);
                            try {
                              // 测试的是已保存配置，结果独立展示；供应商可能计入少量用量。
                              const result = await backend.testModel();
                              setTestResult({ ok: true, text: result.message });
                            } catch (e) {
                              setTestResult({
                                ok: false,
                                text: (e as Error).message,
                              });
                            } finally {
                              setTesting(false);
                            }
                          }}
                        >
                          测试已保存的模型
                        </Button>
                      </div>
                      <p className="muted model-help">
                        连接测试会发起一次少量 token
                        的真实请求。修改后请先保存。
                      </p>
                      {testResult && (
                        <Alert
                          type={testResult.ok ? "success" : "error"}
                          title={testResult.text}
                        />
                      )}
                    </Form>
                  )}
                </section>
                <section className="glass mint settings-card">
                  <span className="pill">随时切换</span>
                  <h2 className="settings-heading">把额度，留给想写的内容。</h2>
                  <p>同一服务商切换模型：修改模型名称，保存即可。</p>
                  <p>切换服务商或账号：一起更新地址、模型和 API Key。</p>
                  <p className="muted">
                    API
                    和后台任务自动读取新配置，已经发出的请求继续使用原配置。密钥仅保存在本机后端，不回传明文，也不写入浏览器存储。
                  </p>
                  <p className="muted">
                    配置已保存不代表额度可用，点击测试可验证实际调用。模型须支持文本对话及
                    JSON 输出。
                  </p>
                </section>
              </div>
            ),
          },
          {
            key: "author",
            label: "作者与预算",
            children: (
              <section className="glass settings-card preferences-card">
                <h2>作者与写作偏好</h2>
                <Form
                  layout="vertical"
                  initialValues={settings}
                  onFinish={async (values) => {
                    setBusy(true);
                    await act(
                      () => api.settings({ ...settings, ...values }),
                      "设置已保存",
                    );
                    setBusy(false);
                  }}
                >
                  <Form.Item
                    label="作者定位"
                    name="author"
                    rules={[{ required: true, whitespace: true }]}
                  >
                    <Input.TextArea rows={2} />
                  </Form.Item>
                  <Form.Item
                    label="表达风格"
                    name="voice"
                    rules={[{ required: true, whitespace: true }]}
                  >
                    <Input />
                  </Form.Item>
                  <div className="two">
                    <Form.Item
                      label="单任务 token 预算"
                      name="budget"
                      rules={[{ required: true }]}
                    >
                      <InputNumber min={1000} max={1000000} step={1000} />
                    </Form.Item>
                    <Form.Item
                      label="每篇评论保存上限"
                      name="comment_limit"
                      rules={[{ required: true }]}
                    >
                      <InputNumber min={0} max={100} />
                    </Form.Item>
                  </div>
                  <p className="muted">
                    预算按输入字节保守预留并限制输出。评论上限为 0
                    时不保存评论。
                  </p>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={busy}
                    disabled={busy}
                  >
                    保存设置
                  </Button>
                </Form>
              </section>
            ),
          },
          {
            key: "connections",
            label: "连接与数据",
            children: (
              <section className="glass settings-card preferences-card">
                <h2>连接状态</h2>
                {isDemo ? (
                  <Alert type="info" title="当前为独立演示模式" />
                ) : (
                  <>
                    {["mcp", "model"].map((key) => {
                      const c = connections?.[key as "mcp" | "model"];
                      return (
                        <div className="connection-row" key={key}>
                          <span>
                            {key === "mcp" ? "小红书 MCP" : "模型服务"}
                          </span>
                          <span className="muted">
                            {c?.message ?? "待检查"}
                          </span>
                        </div>
                      );
                    })}
                    <p>
                      后台 worker：
                      {connections?.worker === "running"
                        ? "运行中"
                        : connections
                          ? "未检测到运行"
                          : "待检查"}
                    </p>
                    <Button onClick={check} loading={checking}>
                      检查连接
                    </Button>
                    <p className="muted model-help">
                      真实数据保存在本机 SQLite。小红书 MCP
                      需启动并完成账号登录；也可以在研究任务页导入 JSON 素材。
                    </p>
                  </>
                )}
                {isDemo && (
                  <Popconfirm
                    title="重置所有演示数据？"
                    onConfirm={() =>
                      act(async () => {
                        await api.reset();
                        location.reload();
                      })
                    }
                  >
                    <Button>重置演示数据</Button>
                  </Popconfirm>
                )}
              </section>
            ),
          },
        ]}
      />
    </>
  );
}
