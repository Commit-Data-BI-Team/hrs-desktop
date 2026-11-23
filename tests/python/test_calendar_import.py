import os
import sys
import unittest
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..','..','scripts')))
from meetings_fetch import fetch_events, normalize_calendar_events

ROOT='https://graph.microsoft.com/v1.0/me/calendarView'
class Reply:
    def __init__(self, status, payload=None, headers=None):
        self.status_code,self.payload,self.headers=status,payload or {},headers or {}
    def json(self):
        return self.payload

class CalendarImportTest(unittest.TestCase):
    def test_long_unicode_meeting_fits_ipc_without_losing_rest_of_month(self):
        event={'subject':'א🙂'*400,'start':{'dateTime':'2026-11-18T07:00:00.0000000Z'},
               'end':{'dateTime':'2026-11-18T08:00:00Z'},'attendees':[{'emailAddress':{'name':'א'*510,'address':'x'*330}}]*50}
        items=normalize_calendar_events([event,None,{**event,'subject':'second'}],'Asia/Jerusalem')
        self.assertEqual(len(items),2)
        self.assertEqual(items[0]['startTime'],'2026-11-18 09:00:00')
        self.assertLessEqual(len(items[0]['subject'].encode('utf-16-le'))//2,500)
        self.assertLessEqual(len(items[0]['participants'].encode('utf-16-le'))//2,20000)
        self.assertEqual(items[0]['attendeeEmails'],[])
        self.assertEqual(items[1]['subject'],'second')

    def test_temporarily_throttled_page_retries_once_without_returning_partial_month(self):
        calls=[]
        replies=iter([Reply(200,{'value':[1],'@odata.nextLink':ROOT+'?p=2'}),Reply(429,headers={'Retry-After':'1'}),Reply(200,{'value':[2]})])
        def get(url, **args):
            self.assertFalse(args['allow_redirects']); calls.append(url); return next(replies)
        waits=[]
        self.assertEqual(fetch_events(ROOT,{},get=get,sleep=waits.append),[1,2])
        self.assertEqual(calls,[ROOT,ROOT+'?p=2',ROOT+'?p=2'])
        self.assertEqual(waits,[1])

    def test_no_retry_on_auth_rejection_or_invalid_or_repeated_continuation(self):
        for reply in [Reply(403),Reply(200,{}),Reply(200,{'value':[],'@odata.nextLink':ROOT}),Reply(200,{'value':[],'@odata.nextLink':'https://example.invalid/elsewhere'})]:
            calls=[]
            def get(url,**_):
                calls.append(url);return reply
            with self.assertRaises(RuntimeError):
                fetch_events(ROOT,{},get=get,sleep=lambda _: self.fail('unexpected retry'))
            self.assertEqual(calls,[ROOT])
