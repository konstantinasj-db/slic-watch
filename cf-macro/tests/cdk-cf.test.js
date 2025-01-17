/* eslint-disable no-template-curly-in-string */
'use strict'

const { test } = require('tap')
const CloudFormationTemplate = require('../../core/cf-template')

const cdkStack = require('./resources/cdk-ecs-cf.json')
const cfMacroHandler = require('../index')

/**
 * Test the synthesized output from the CDK ECS Stack in `cdk-test-project`
 */
test('ECS CDK stack', async (t) => {
  const event = {
    fragment: cdkStack
  }
  const handlerResponse = await cfMacroHandler.handler(event)
  t.equal(handlerResponse.status, 'success')
  const transformedTemplate = CloudFormationTemplate(handlerResponse.fragment)

  test('alarms are generated', (t) => {
    const alarms = transformedTemplate.getResourcesByType('AWS::CloudWatch::Alarm')
    t.equal(Object.keys(alarms).length, 6)
    const alarmNames = Object.values(alarms).map(alarm => alarm.Properties.AlarmName).sort()
    t.same(alarmNames, [
      'LoadBalancerHTTPCodeELB5XXCountAlarm_MyWebServerLB3B5FD3AB',
      'LoadBalancerHTTPCodeTarget5XXCountAlarm_MyWebServerLBPublicListenerECSGroup5AB9F1C3',
      'LoadBalancerRejectedConnectionCountAlarm_MyWebServerLB3B5FD3AB',
      'LoadBalancerUnHealthyHostCountAlarm_MyWebServerLBPublicListenerECSGroup5AB9F1C3',
      { 'Fn::Sub': 'ECS_MemoryAlarm_${MyWebServerService2FE7341D.Name}' },
      { 'Fn::Sub': 'ECS_CPUAlarm_${MyWebServerService2FE7341D.Name}' }
    ])
    t.end()
  })

  t.end()
})
