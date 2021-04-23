'use strict'

const MAX_WIDTH = 24

const LAMBDA_METRICS = {
  Errors: ['Sum'],
  Throttles: ['Sum'],
  Duration: ['Average', 'p95', 'Maximum'],
  Invocations: ['Sum'],
  ConcurrentExecutions: ['Maximum']
}

const API_METRICS = {
  '5XXError': ['Sum'],
  '4XXError': ['Sum'],
  Latency: ['Average', 'p95'],
  Count: ['Sum']
}

const STATES_METRICS = {
  ExecutionsFailed: ['Sum'],
  ExecutionsThrottled: ['Sum'],
  ExecutionsTimedOut: ['Sum']
}

module.exports = function dashboard (serverless, dashboardConfig, context) {
  const config = dashboardConfig

  return {
    addDashboard
  }

  /**
   * Adds a dashboard to the specified CloudFormation template
   * based on the resources provided in the template.
   *
   * @param {object} cfTemplate A CloudFormation template
   */
  function addDashboard (cfTemplate) {
    const apiResources = cfTemplate.getResourcesByType(
      'AWS::ApiGateway::RestApi'
    )
    const stateMachineResources = cfTemplate.getResourcesByType(
      'AWS::StepFunctions::StateMachine'
    )
    const lambdaResources = cfTemplate.getResourcesByType(
      'AWS::Lambda::Function'
    )
    const eventSourceMappingFunctions = cfTemplate.getEventSourceMappingFunctions()
    const apiWidgets = createApiWidgets(apiResources)
    const stateMachineWidgets = createStateMachineWidgets(stateMachineResources)
    const lambdaWidgets = createLambdaWidgets(
      lambdaResources,
      Object.keys(eventSourceMappingFunctions)
    )
    const positionedWidgets = layOutWidgets([
      ...apiWidgets,
      ...stateMachineWidgets,
      ...lambdaWidgets
    ])
    const dash = { start: config.timeRange, end: config.timeRange.end, widgets: positionedWidgets }
    const dashboardResource = {
      Type: 'AWS::CloudWatch::Dashboard',
      Properties: {
        DashboardName: `${context.stackName}Dashboard`,
        DashboardBody: { 'Fn::Sub': JSON.stringify(dash) }
      }
    }
    cfTemplate.addResource('slicWatchDashboard', dashboardResource)
  }

  /**
   * Create a metric for the specified metrics
   *
   * @param {string} title The metric title
   * @param {Array.<object>} metrics The metric definitions to render
   */
  function createMetricWidget (title, metricDefs) {
    const metrics = metricDefs.map(
      ({ namespace, metric, dimensions, stat }) => [
        namespace,
        metric,
        ...Object.entries(dimensions).reduce(
          (acc, [name, value]) => [...acc, name, value],
          []
        ),
        [{ stat }]
      ]
    )

    return {
      type: 'metric',
      properties: {
        metrics,
        title,
        view: 'timeSeries',
        region: context.region,
        period: config.metricPeriod
      }
    }
  }

  /**
   * Create a set of CloudWatch Dashboard widgets for the Lambda
   * CloudFormation resources provided
   *
   * @param {object} functionResources Object with of CloudFormation Lambda Function resources by resource name
   * @param {Array.<string>} eventSourceMappingFunctionResourceNames Names of Lambda function resources that are linked to EventSourceMappings
   */
  function createLambdaWidgets (
    functionResources,
    eventSourceMappingFunctionResourceNames
  ) {
    const lambdaWidgets = []
    for (const [metric, stats] of Object.entries(LAMBDA_METRICS)) {
      for (const stat of stats) {
        const metricStatWidget = createMetricWidget(
          `Lambda ${metric} ${stat} per Function`,
          Object.values(functionResources).map((res) => ({
            namespace: 'AWS/Lambda',
            metric,
            dimensions: {
              FunctionName: res.Properties.FunctionName
            },
            stat
          }))
        )
        lambdaWidgets.push(metricStatWidget)
      }
    }
    if (eventSourceMappingFunctionResourceNames.length > 0) {
      const iteratorAgeWidget = createMetricWidget(
        'Lambda IteratorAge Maximum per Function',
        Object.keys(functionResources)
          .filter((resName) =>
            eventSourceMappingFunctionResourceNames.includes(resName)
          )
          .map((resName) => ({
            namespace: 'AWS/Lambda',
            metric: 'IteratorAge',
            dimensions: {
              FunctionName: functionResources[resName].Properties.FunctionName
            },
            stat: 'Maximum'
          }))
      )
      lambdaWidgets.push(iteratorAgeWidget)
    }

    return lambdaWidgets
  }

  /**
   * Create a set of CloudWatch Dashboard widgets for the API Gateway REST API
   * CloudFormation resources provided
   *
   * @param {object} apiResources Object of CloudFormation RestApi resources by resource name
   */
  function createApiWidgets (apiResources) {
    const apiWidgets = []
    for (const res of Object.values(apiResources)) {
      const apiName = res.Properties.Name // TODO: Allow for Ref usage in resource names
      for (const [metric, stats] of Object.entries(API_METRICS)) {
        const metricStatWidget = createMetricWidget(
          `${metric} for ${apiName} API`,
          Object.values(stats).map((stat) => ({
            namespace: 'AWS/ApiGateway',
            metric,
            dimensions: {
              ApiName: apiName
            },
            stat
          }))
        )
        apiWidgets.push(metricStatWidget)
      }
    }
    return apiWidgets
  }

  /**
   * Create a set of CloudWatch Dashboard widgets for the Step Function State Machines
   * CloudFormation resources provided
   *
   * @param {object} smResources Object of Step Function State Machine resources by resource name
   */
  function createStateMachineWidgets (smResources) {
    const smWidgets = []
    for (const res of Object.values(smResources)) {
      const smName = res.Properties.StateMachineName // TODO: Allow for Ref usage in resource names (see #14)
      const widgetMetrics = []
      for (const [metric, stats] of Object.entries(STATES_METRICS)) {
        for (const stat of stats) {
          widgetMetrics.push({
            namespace: 'AWS/States',
            metric,
            dimensions: {
              StateMachineArn: `arn:aws:states:\${AWS::Region}:\${AWS::AccountId}:stateMachine:${smName}`
            },
            stat
          })
        }
      }
      const metricStatWidget = createMetricWidget(
        `${smName} Step Function Executions`,
        widgetMetrics
      )
      smWidgets.push(metricStatWidget)
    }
    return smWidgets
  }

  /**
   * Set the location and dimension properties of each provided widget
   *
   * @param {Array.<object>} widgets A set of dashboard widgets
   * @return {Array.<object>} A set of dashboard widgets with layout properties set
   */
  function layOutWidgets (widgets) {
    let x = 0
    let y = 0

    const { widgetHeight, widgetWidth } = config.layout

    return widgets.map((widget) => {
      if (x + widgetWidth > MAX_WIDTH) {
        y += widgetHeight
        x = 0
      }
      const positionedWidget = {
        ...widget,
        x,
        y,
        width: widgetWidth,
        height: widgetHeight
      }
      x += widgetWidth
      return positionedWidget
    })
  }
}
